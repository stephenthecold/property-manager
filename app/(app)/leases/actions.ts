"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { toCents } from "@/lib/money";
import { requireRole, auditActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/audit";
import { generateChargesForLease } from "@/lib/services/billing";
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
    await generateChargesForLease(lease, unit.property.timezone, new Date());
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
