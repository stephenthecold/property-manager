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
  const tz = unit.property.timezone;

  const lateFeeType = (str(fd, "lateFeeType") || "none") as LateFeeType;
  const status = (str(fd, "status") || "active") as LeaseStatus;
  const now = new Date();
  const startDate = str(fd, "startDate")
    ? (parseDateOnlyInZone(str(fd, "startDate"), tz) ?? new Date(str(fd, "startDate")))
    : now;

  const endRaw = str(fd, "endDate");
  const endDate = endRaw ? parseDateOnlyInZone(endRaw, tz) : null;
  if (endRaw && !endDate) throw new Error("End date must be a valid date.");

  // Backdated leases: optionally start billing at the NEXT due date instead
  // of back-filling every period since startDate, and post what the tenant
  // still owes (including any in-progress period) as an opening-balance
  // adjustment (0/empty = caught up).
  const billingStart = str(fd, "billingStart") || "start";
  const billingStartDate = billingStart === "current" ? now : null;
  const openingRaw = str(fd, "openingBalance");
  let openingBalanceCents: bigint;
  try {
    openingBalanceCents = openingRaw ? toCents(openingRaw) : 0n;
  } catch {
    throw new Error("Opening balance must be a valid amount (e.g. 500.00).");
  }
  if (openingBalanceCents < 0n) {
    throw new Error("Opening balance cannot be negative (use a credit adjustment instead).");
  }
  if (openingBalanceCents > 0n && billingStart !== "current") {
    throw new Error(
      "An opening balance only applies when billing starts at the next due date — " +
        "with full-history billing the back-filled charges already represent the past debt.",
    );
  }

  // Co-tenants: any additional tenants on the lease (primary excluded).
  const coTenantIds = [
    ...new Set(
      fd
        .getAll("coTenants")
        .map((v) => String(v).trim())
        .filter((id) => id && id !== tenantId),
    ),
  ];

  let lease;
  try {
    lease = await prisma.$transaction(async (tx) => {
      const created = await tx.lease.create({
        data: {
          tenantId,
          unitId,
          startDate,
          endDate,
          billingStartDate,
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
      if (coTenantIds.length > 0) {
        await tx.leaseTenant.createMany({
          data: coTenantIds.map((id) => ({ leaseId: created.id, tenantId: id })),
        });
      }
      if (openingBalanceCents > 0n) {
        await tx.ledgerEntry.create({
          data: {
            leaseId: created.id,
            tenantId,
            entryType: "adjustment",
            amountCents: openingBalanceCents,
            effectiveDate: billingStartDate ?? startDate,
            sourceType: "opening_balance",
            description: "Opening balance (pre-existing debt at lease entry)",
          },
        });
      }
      await writeAudit(tx, {
        ...(await auditActor()),
        action: "lease.created",
        entityType: "Lease",
        entityId: created.id,
        after: {
          tenantId,
          unitId,
          status,
          coTenantIds,
          openingBalanceCents,
          billingStartDate,
        },
      });
      return created;
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
    await generateChargesForLease(lease, unit, tz, now);
  }

  redirect(`/tenants/${tenantId}`);
}

/**
 * Extend / renew a lease (re-sign): set a new end date (empty = open-ended)
 * and optionally flip between active and month-to-month. A new rate for the
 * renewal should be scheduled separately as a rent increase so period pricing
 * stays historically correct.
 */
export async function renewLease(fd: FormData): Promise<void> {
  await requireRole("manager");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) throw new Error("Missing lease id.");
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: true } } },
  });
  if (!lease) throw new Error("Lease not found.");
  if (lease.status === "ended") {
    throw new Error("This lease has ended — create a new lease instead.");
  }

  const tz = lease.unit.property.timezone;
  const endRaw = str(fd, "endDate");
  const endDate = endRaw ? parseDateOnlyInZone(endRaw, tz) : null;
  if (endRaw && !endDate) throw new Error("End date must be a valid date.");
  if (endDate && endDate <= lease.startDate) {
    throw new Error("End date must be after the lease start date.");
  }
  const statusRaw = str(fd, "status");
  const status =
    statusRaw === "active" || statusRaw === "month_to_month"
      ? (statusRaw as LeaseStatus)
      : lease.status;

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.renewed",
      entityType: "Lease",
      entityId: lease.id,
      before: { endDate: lease.endDate, status: lease.status },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: { endDate, status },
      });
      return { result: updated, after: { endDate, status } };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
  revalidatePath("/leases");
}

export async function addCoTenant(fd: FormData): Promise<void> {
  await requireRole("manager");
  const leaseId = str(fd, "leaseId");
  const tenantId = str(fd, "tenantId");
  if (!leaseId || !tenantId) throw new Error("Choose a tenant to add.");
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) throw new Error("Lease not found.");
  if (lease.tenantId === tenantId) {
    throw new Error("That tenant is already the primary tenant on this lease.");
  }

  try {
    await withAudit(
      {
        ...(await auditActor()),
        action: "lease.cotenant_added",
        entityType: "Lease",
        entityId: lease.id,
      },
      async (tx) => {
        const row = await tx.leaseTenant.create({ data: { leaseId, tenantId } });
        return { result: row, after: { tenantId } };
      },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error("That tenant is already on this lease.");
    }
    throw e;
  }

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/tenants/${tenantId}`);
}

export async function removeCoTenant(fd: FormData): Promise<void> {
  await requireRole("manager");
  const id = str(fd, "leaseTenantId");
  if (!id) throw new Error("Missing co-tenant id.");
  const row = await prisma.leaseTenant.findUnique({
    where: { id },
    include: { lease: true },
  });
  if (!row) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.cotenant_removed",
      entityType: "Lease",
      entityId: row.leaseId,
      before: { tenantId: row.tenantId },
    },
    async (tx) => {
      await tx.leaseTenant.delete({ where: { id } });
      return { result: undefined };
    },
  );

  revalidatePath(`/tenants/${row.lease.tenantId}`);
  revalidatePath(`/tenants/${row.tenantId}`);
}

export async function addLeaseDeposit(fd: FormData): Promise<void> {
  await requireRole("manager");
  const leaseId = str(fd, "leaseId");
  const label = str(fd, "label");
  const amountRaw = str(fd, "amount");
  if (!leaseId || !label || !amountRaw) {
    throw new Error("Deposit label and amount are required.");
  }
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) throw new Error("Lease not found.");

  const amountCents = toCents(amountRaw);
  if (amountCents <= 0n) throw new Error("Deposit amount must be positive.");
  const nonRefundableCents = centsOrNull(str(fd, "nonRefundable")) ?? 0n;
  if (nonRefundableCents < 0n || nonRefundableCents > amountCents) {
    throw new Error("Non-refundable portion must be between 0 and the deposit amount.");
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.deposit_added",
      entityType: "Lease",
      entityId: lease.id,
    },
    async (tx) => {
      const dep = await tx.leaseDeposit.create({
        data: {
          leaseId,
          label,
          amountCents,
          nonRefundableCents,
          notes: str(fd, "depositNotes") || null,
        },
      });
      return {
        result: dep,
        after: { label, amountCents, nonRefundableCents },
      };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
}

export async function removeLeaseDeposit(fd: FormData): Promise<void> {
  await requireRole("manager");
  const id = str(fd, "depositId");
  if (!id) throw new Error("Missing deposit id.");
  const dep = await prisma.leaseDeposit.findUnique({
    where: { id },
    include: { lease: true },
  });
  if (!dep) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.deposit_removed",
      entityType: "Lease",
      entityId: dep.leaseId,
      before: {
        label: dep.label,
        amountCents: dep.amountCents,
        nonRefundableCents: dep.nonRefundableCents,
      },
    },
    async (tx) => {
      await tx.leaseDeposit.delete({ where: { id } });
      return { result: undefined };
    },
  );

  revalidatePath(`/tenants/${dep.lease.tenantId}`);
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
