import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import { computeDisposition, type DepositDisposition } from "@/lib/inspections/disposition";
import type { InspectionType } from "@/lib/generated/prisma/enums";

/**
 * Bridges Inspection rows to the pure disposition math. Inspections are OPERATING
 * records — they never touch the ledger (deposits live on LeaseDeposit). Every
 * mutation is audited. The move-out deposit disposition is computed on read from
 * the lease's deposits minus the inspection's itemized deductions.
 */

export async function listInspections() {
  return prisma.inspection.findMany({
    orderBy: [{ status: "asc" }, { scheduledFor: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      _count: { select: { items: true } },
      lease: {
        select: {
          tenantId: true,
          tenant: { select: { firstName: true, lastName: true } },
          unit: { select: { id: true, unitNumber: true, property: { select: { name: true, timezone: true } } } },
        },
      },
    },
  });
}

export async function getInspection(id: string) {
  return prisma.inspection.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      lease: {
        select: {
          id: true,
          tenantId: true,
          tenant: { select: { firstName: true, lastName: true } },
          unit: { select: { id: true, unitNumber: true, property: { select: { name: true, timezone: true } } } },
        },
      },
    },
  });
}

/** Total + non-refundable deposit cents for a lease. */
async function depositTotals(leaseId: string): Promise<{
  depositTotalCents: bigint;
  nonRefundableCents: bigint;
}> {
  const agg = await prisma.leaseDeposit.aggregate({
    where: { leaseId },
    _sum: { amountCents: true, nonRefundableCents: true },
  });
  return {
    depositTotalCents: agg._sum.amountCents ?? 0n,
    nonRefundableCents: agg._sum.nonRefundableCents ?? 0n,
  };
}

/** Move-out deposit disposition for an inspection (deposits − its deductions). */
export async function dispositionForInspection(
  inspectionId: string,
  leaseId: string,
): Promise<DepositDisposition> {
  const [totals, items] = await Promise.all([
    depositTotals(leaseId),
    prisma.inspectionItem.aggregate({
      where: { inspectionId },
      _sum: { amountCents: true },
    }),
  ]);
  return computeDisposition({
    ...totals,
    deductionsCents: items._sum.amountCents ?? 0n,
  });
}

export async function createInspection(input: {
  leaseId: string;
  type: InspectionType;
  scheduledFor: Date | null;
  inspector: string | null;
  actor: AuditContext;
}): Promise<{ id: string } | { error: string }> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true },
  });
  if (!lease) return { error: "Lease not found." };

  const created = await withAudit(
    {
      ...input.actor,
      action: "inspection.created",
      entityType: "Inspection",
      entityId: "(new)",
    },
    async (tx) => {
      const row = await tx.inspection.create({
        data: {
          leaseId: input.leaseId,
          type: input.type,
          status: "scheduled",
          scheduledFor: input.scheduledFor,
          inspector: input.inspector,
          createdBy: input.actor.actorId ?? null,
        },
      });
      return {
        result: row,
        entityId: row.id,
        after: { leaseId: input.leaseId, type: input.type },
      };
    },
  );
  return { id: created.id };
}

export async function completeInspection(input: {
  id: string;
  summary: string | null;
  completedAt: Date;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const insp = await prisma.inspection.findUnique({ where: { id: input.id } });
  if (!insp) return { ok: false, error: "Inspection not found." };
  if (insp.status === "canceled") {
    return { ok: false, error: "A canceled inspection can't be completed." };
  }
  await withAudit(
    {
      ...input.actor,
      action: "inspection.completed",
      entityType: "Inspection",
      entityId: insp.id,
    },
    async (tx) => {
      await tx.inspection.update({
        where: { id: insp.id },
        data: { status: "completed", completedAt: input.completedAt, summary: input.summary },
      });
      return { result: undefined, after: { completedAt: input.completedAt.toISOString() } };
    },
  );
  return { ok: true };
}

export async function cancelInspection(input: {
  id: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const insp = await prisma.inspection.findUnique({ where: { id: input.id } });
  if (!insp || insp.status === "canceled") return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "inspection.canceled",
      entityType: "Inspection",
      entityId: insp.id,
      before: { status: insp.status },
    },
    async (tx) => {
      await tx.inspection.update({ where: { id: insp.id }, data: { status: "canceled" } });
      return { result: undefined };
    },
  );
  return { ok: true };
}

export async function addDeduction(input: {
  inspectionId: string;
  label: string;
  amountCents: bigint;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const insp = await prisma.inspection.findUnique({ where: { id: input.inspectionId } });
  if (!insp) return { ok: false, error: "Inspection not found." };
  if (insp.status === "canceled") {
    return { ok: false, error: "A canceled inspection can't take deductions." };
  }
  await withAudit(
    {
      ...input.actor,
      action: "inspection.deduction_added",
      entityType: "Inspection",
      entityId: insp.id,
    },
    async (tx) => {
      await tx.inspectionItem.create({
        data: {
          inspectionId: insp.id,
          label: input.label,
          amountCents: input.amountCents,
        },
      });
      return {
        result: undefined,
        after: { label: input.label, amountCents: input.amountCents.toString() },
      };
    },
  );
  return { ok: true };
}

export async function removeDeduction(input: {
  itemId: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const item = await prisma.inspectionItem.findUnique({ where: { id: input.itemId } });
  if (!item) return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "inspection.deduction_removed",
      entityType: "Inspection",
      entityId: item.inspectionId,
      before: { label: item.label, amountCents: item.amountCents.toString() },
    },
    async (tx) => {
      await tx.inspectionItem.delete({ where: { id: item.id } });
      return { result: undefined };
    },
  );
  return { ok: true };
}
