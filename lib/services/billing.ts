import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Lease, Unit } from "@/lib/generated/prisma/client";
import { fromCents } from "@/lib/money";
import { computeLateFeeCents } from "@/lib/accounting/fees";
import { graceDeadline, listExpectedPeriods } from "@/lib/accounting/periods";
import { rentForPeriod, shouldApplyScheduledRent } from "@/lib/accounting/rent";
import { writeAudit } from "@/lib/audit/audit";

/**
 * Idempotent rent-charge generation and late-fee assessment, run by the worker.
 * Idempotency is enforced by the partial unique indexes
 * UNIQUE(leaseId, periodKey) WHERE entryType IN (rent_charge | late_fee):
 * a duplicate insert raises P2002 and is skipped, so re-runs/concurrent runs
 * converge to exactly one charge (and one late fee) per period.
 */

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

export async function generateChargesForLease(
  lease: Lease,
  unit: Pick<Unit, "internetEnabled" | "internetFeeCents">,
  tz: string,
  now: Date,
): Promise<number> {
  const periods = listExpectedPeriods({
    startDate: lease.startDate,
    endDate: lease.endDate,
    dueDay: lease.dueDay,
    tz,
    now,
    billingStart: lease.billingStartDate,
  });
  let created = 0;
  for (const p of periods) {
    const rent = rentForPeriod(
      {
        rentAmountCents: lease.rentAmountCents,
        scheduledRentAmountCents: lease.scheduledRentAmountCents,
        scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
        internetEnabled: unit.internetEnabled,
        internetFeeCents: unit.internetFeeCents,
      },
      p.periodKey,
      tz,
    );
    try {
      await prisma.ledgerEntry.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          entryType: "rent_charge",
          amountCents: rent.totalCents,
          periodKey: p.periodKey,
          effectiveDate: p.dueDate,
          sourceType: "charge",
          description:
            rent.internetFeeCents > 0n
              ? `Monthly rent (incl. internet ${fromCents(rent.internetFeeCents)})`
              : "Monthly rent",
        },
      });
      created++;
    } catch (e) {
      if (isUniqueViolation(e)) continue; // already generated for this period
      throw e;
    }
  }
  return created;
}

/**
 * Roll due scheduled rent increases into `rentAmountCents` and clear the
 * schedule, with a system audit row. Runs AFTER charge generation in a billing
 * pass so back-filled periods before the effective date still price at the old
 * rent. The guarded updateMany makes concurrent runs apply (and audit) once.
 */
export async function applyScheduledRentIncreases(now: Date): Promise<number> {
  const due = await prisma.lease.findMany({
    where: {
      status: { in: ["active", "month_to_month"] },
      scheduledRentAmountCents: { not: null },
      scheduledRentEffectiveDate: { not: null, lte: now },
    },
    include: { unit: { include: { property: true } } },
  });

  let applied = 0;
  for (const lease of due) {
    const tz = lease.unit.property.timezone;
    if (!shouldApplyScheduledRent(lease, now, tz)) continue;
    const newRent = lease.scheduledRentAmountCents!;
    await prisma.$transaction(async (tx) => {
      const res = await tx.lease.updateMany({
        // Full compare-and-swap on the schedule snapshot: a concurrent
        // re-schedule of the SAME amount to a different date must also skip.
        where: {
          id: lease.id,
          scheduledRentAmountCents: newRent,
          scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
        },
        data: {
          rentAmountCents: newRent,
          scheduledRentAmountCents: null,
          scheduledRentEffectiveDate: null,
        },
      });
      if (res.count === 0) return; // applied or re-scheduled elsewhere; next run re-evaluates
      await writeAudit(tx, {
        actorType: "system",
        action: "lease.rent_increase_applied",
        entityType: "Lease",
        entityId: lease.id,
        before: { rentAmountCents: lease.rentAmountCents },
        after: {
          rentAmountCents: newRent,
          effectiveDate: lease.scheduledRentEffectiveDate,
        },
      });
      applied++;
    });
  }
  return applied;
}

export async function assessLateFeesForLease(
  lease: Lease,
  tz: string,
  now: Date,
): Promise<number> {
  if (lease.lateFeeType === "none") return 0;

  const [rentCharges, lateFees, allocations] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { leaseId: lease.id, entryType: "rent_charge" },
    }),
    prisma.ledgerEntry.findMany({
      where: { leaseId: lease.id, entryType: "late_fee" },
      select: { periodKey: true },
    }),
    prisma.chargeAllocation.findMany({
      where: { chargeEntry: { leaseId: lease.id } },
    }),
  ]);

  const lateFeePeriods = new Set(lateFees.map((l) => l.periodKey));
  const reversedIds = new Set(
    allocations.map((a) => a.reversesAllocationId).filter((x): x is string => !!x),
  );
  const allocated: Record<string, bigint> = {};
  for (const a of allocations) {
    if (a.reversesAllocationId) continue;
    if (reversedIds.has(a.id)) continue;
    allocated[a.chargeEntryId] = (allocated[a.chargeEntryId] ?? 0n) + a.amountCents;
  }

  let created = 0;
  for (const ch of rentCharges) {
    if (!ch.periodKey || lateFeePeriods.has(ch.periodKey)) continue;
    const outstanding = ch.amountCents - (allocated[ch.id] ?? 0n);
    if (outstanding <= 0n) continue;
    if (now <= graceDeadline(ch.effectiveDate, lease.gracePeriodDays, tz)) continue;

    const fee = computeLateFeeCents({
      type: lease.lateFeeType,
      rentChargeCents: ch.amountCents,
      fixedAmountCents: lease.lateFeeAmountCents,
      bps: lease.lateFeeBps,
    });
    if (fee <= 0n) continue;

    try {
      await prisma.ledgerEntry.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          entryType: "late_fee",
          amountCents: fee,
          periodKey: ch.periodKey,
          effectiveDate: now,
          sourceType: "late_fee",
          description: `Late fee for ${ch.periodKey}`,
        },
      });
      created++;
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  return created;
}

export interface BillingRunResult {
  leasesProcessed: number;
  chargesCreated: number;
  lateFeesCreated: number;
  rentIncreasesApplied: number;
}

/** Run charge generation + late-fee assessment across all active leases. */
export async function runBilling(now = new Date()): Promise<BillingRunResult> {
  const leases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
    include: { unit: { include: { property: true } } },
  });

  let chargesCreated = 0;
  let lateFeesCreated = 0;
  for (const lease of leases) {
    const tz = lease.unit.property.timezone;
    chargesCreated += await generateChargesForLease(lease, lease.unit, tz, now);
    lateFeesCreated += await assessLateFeesForLease(lease, tz, now);
  }
  // After charging, so back-filled periods keep their historical pricing.
  const rentIncreasesApplied = await applyScheduledRentIncreases(now);
  return {
    leasesProcessed: leases.length,
    chargesCreated,
    lateFeesCreated,
    rentIncreasesApplied,
  };
}
