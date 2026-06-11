"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { toCents } from "@/lib/money";
import { requireRole, auditActor } from "@/lib/auth/session";
import { writeAudit, withAudit } from "@/lib/audit/audit";
import { generateChargesForLease } from "@/lib/services/billing";
import { daysBetween, parseDateOnlyInZone } from "@/lib/accounting/periods";
import { DateTime } from "luxon";
import type { LateFeeType, LeaseStatus } from "@/lib/generated/prisma/enums";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function centsOrNull(v: string): bigint | null {
  if (!v) return null;
  try {
    return toCents(v);
  } catch {
    return null;
  }
}

export async function createLease(fd: FormData): Promise<void> {
  await requireRole("manager");
  const tenantId = str(fd, "tenantId");
  const unitId = str(fd, "unitId");
  const rentRaw = str(fd, "rentAmount");
  if (!tenantId || !unitId || !rentRaw) {
    throw new Error("Tenant, unit, and rent amount are required.");
  }
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { property: true },
  });
  if (!unit) throw new Error("Unit not found.");

  const lateFeeType = (str(fd, "lateFeeType") || "none") as LateFeeType;
  const status = (str(fd, "status") || "active") as LeaseStatus;
  const startDate = str(fd, "startDate")
    ? new Date(str(fd, "startDate"))
    : new Date();

  let lease;
  try {
    lease = await prisma.lease.create({
      data: {
        tenantId,
        unitId,
        startDate,
        endDate: str(fd, "endDate") ? new Date(str(fd, "endDate")) : null,
        rentAmountCents: toCents(rentRaw),
        dueDay: Number(str(fd, "dueDay") || "1"),
        gracePeriodDays: Number(str(fd, "gracePeriodDays") || "0"),
        lateFeeType,
        lateFeeAmountCents:
          lateFeeType === "fixed" ? centsOrNull(str(fd, "lateFeeAmount")) : null,
        lateFeeBps:
          lateFeeType === "percentage"
            ? Number(str(fd, "lateFeeAmount") || "0") || null
            : null,
        securityDepositCents: centsOrNull(str(fd, "securityDeposit")) ?? 0n,
        status,
        notes: str(fd, "notes") || null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("That unit already has an active lease.");
    }
    throw e;
  }

  if (status === "active" || status === "month_to_month") {
    await prisma.unit.update({
      where: { id: unitId },
      data: { occupancyStatus: "occupied" },
    });
    await generateChargesForLease(lease, unit, unit.property.timezone, new Date());
  }

  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "lease.created",
    entityType: "Lease",
    entityId: lease.id,
    after: { tenantId, unitId, status },
  });

  redirect(`/tenants/${tenantId}`);
}

export async function scheduleRentIncrease(fd: FormData): Promise<void> {
  await requireRole("manager");
  const leaseId = str(fd, "leaseId");
  const amountRaw = str(fd, "newRentAmount");
  const dateRaw = str(fd, "effectiveDate");
  if (!leaseId || !amountRaw || !dateRaw) {
    throw new Error("New rent amount and effective date are required.");
  }
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: true } } },
  });
  if (!lease) throw new Error("Lease not found.");
  if (lease.status !== "active" && lease.status !== "month_to_month") {
    throw new Error("Rent increases can only be scheduled on active leases.");
  }

  const newRent = toCents(amountRaw);
  if (newRent <= 0n) throw new Error("New rent must be greater than zero.");
  const tz = lease.unit.property.timezone;
  const effectiveDate = parseDateOnlyInZone(dateRaw, tz);
  if (!effectiveDate) throw new Error("Effective date must be a valid date.");
  if (daysBetween(new Date(), effectiveDate, tz) < 0) {
    throw new Error("Effective date must be today or later.");
  }
  // Already-charged periods are immutable (append-only ledger + idempotency
  // index), so an increase dated into a charged period could never apply to it.
  const effectiveKey = DateTime.fromJSDate(effectiveDate, { zone: tz }).toFormat(
    "yyyy-MM-dd",
  );
  const lastCharged = await prisma.ledgerEntry.findFirst({
    where: { leaseId: lease.id, entryType: "rent_charge" },
    orderBy: { periodKey: "desc" },
    select: { periodKey: true },
  });
  if (lastCharged?.periodKey && effectiveKey <= lastCharged.periodKey) {
    throw new Error(
      `Rent through the period due ${lastCharged.periodKey} has already been charged; choose a later effective date.`,
    );
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.rent_increase_scheduled",
      entityType: "Lease",
      entityId: lease.id,
      before: {
        rentAmountCents: lease.rentAmountCents,
        scheduledRentAmountCents: lease.scheduledRentAmountCents,
        scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
      },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: {
          scheduledRentAmountCents: newRent,
          scheduledRentEffectiveDate: effectiveDate,
        },
      });
      return {
        result: updated,
        after: {
          scheduledRentAmountCents: newRent,
          scheduledRentEffectiveDate: effectiveDate,
        },
      };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
  revalidatePath("/leases");
}

export async function cancelRentIncrease(fd: FormData): Promise<void> {
  await requireRole("manager");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) throw new Error("Missing lease id.");
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) throw new Error("Lease not found.");
  if (lease.scheduledRentAmountCents == null) return; // nothing to cancel

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.rent_increase_cancelled",
      entityType: "Lease",
      entityId: lease.id,
      before: {
        scheduledRentAmountCents: lease.scheduledRentAmountCents,
        scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
      },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: {
          scheduledRentAmountCents: null,
          scheduledRentEffectiveDate: null,
        },
      });
      return { result: updated, after: { scheduledRentAmountCents: null } };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
  revalidatePath("/leases");
}

export async function terminateLease(fd: FormData): Promise<void> {
  await requireRole("manager");
  const leaseId = String(fd.get("leaseId") ?? "");
  if (!leaseId) throw new Error("Missing lease id.");
  const lease = await prisma.lease.update({
    where: { id: leaseId },
    data: { status: "ended", endDate: new Date() },
  });
  await prisma.unit.update({
    where: { id: lease.unitId },
    data: { occupancyStatus: "vacant" },
  });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "lease.terminated",
    entityType: "Lease",
    entityId: lease.id,
    after: { status: "ended" },
  });
  revalidatePath("/leases");
  revalidatePath(`/tenants/${lease.tenantId}`);
}
