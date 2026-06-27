import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Lease } from "@/lib/generated/prisma/client";
import { fromCents } from "@/lib/money";
import { netReversalsIntoCharges } from "@/lib/accounting/allocation";
import {
  computeLateFeeCents,
  dailyLateFeeAccruals,
  dailyLateFeePeriodKey,
} from "@/lib/accounting/fees";
import { graceDeadline, listExpectedPeriods } from "@/lib/accounting/periods";
import {
  prorationForStart,
  rentForPeriod,
  shouldApplyScheduledRent,
} from "@/lib/accounting/rent";
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
  tz: string,
  now: Date,
): Promise<number> {
  // Internet add-on is billed at the LEASE level (the unit's fields are only
  // the default for new leases).
  const terms = {
    rentAmountCents: lease.rentAmountCents,
    scheduledRentAmountCents: lease.scheduledRentAmountCents,
    scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
    internetEnabled: lease.internetEnabled,
    internetFeeCents: lease.internetFeeCents,
  };
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
    const rent = rentForPeriod(terms, p.periodKey, tz);
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

  // Opt-in prorated move-in charge for mid-period starts. Keyed to the
  // otherwise-never-billed partial period, so the same idempotency index
  // applies. Skipped for next-due-date imports (billingStartDate set) — there
  // the opening balance carries any partial-month rent.
  if (lease.prorateFirstPeriod && !lease.billingStartDate) {
    const pro = prorationForStart({
      startDate: lease.startDate,
      dueDay: lease.dueDay,
      tz,
      terms,
      endDate: lease.endDate,
    });
    if (pro && pro.amountCents > 0n && lease.startDate <= now) {
      try {
        await prisma.ledgerEntry.create({
          data: {
            leaseId: lease.id,
            tenantId: lease.tenantId,
            entryType: "rent_charge",
            amountCents: pro.amountCents,
            periodKey: pro.periodKey,
            effectiveDate: lease.startDate,
            sourceType: "charge",
            description: `Prorated rent (move-in, ${pro.daysCharged}/${pro.daysInMonth} days)`,
          },
        });
        created++;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
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

  const [rentCharges, lateFees, allocations, reversals] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { leaseId: lease.id, entryType: "rent_charge" },
    }),
    prisma.ledgerEntry.findMany({
      where: { leaseId: lease.id, entryType: "late_fee" },
      select: { periodKey: true, amountCents: true },
    }),
    prisma.chargeAllocation.findMany({
      where: { chargeEntry: { leaseId: lease.id } },
    }),
    // Waiver/void reversals — netted into their target charge below so a
    // waived rent charge stops accruing daily late fees.
    prisma.ledgerEntry.findMany({
      where: { leaseId: lease.id, entryType: "reversal", reversesEntryId: { not: null } },
      select: { amountCents: true, reversesEntryId: true },
    }),
  ]);

  const lateFeePeriods = new Set(lateFees.map((l) => l.periodKey));
  // Per-period DAILY posted state: highest day index and actual posted total,
  // so accrual resumes after what exists and the cap binds the real ledger sum
  // even if the rate/cap changed mid-delinquency.
  const dailyPosted = new Map<string, { lastDay: number; totalCents: bigint }>();
  for (const lf of lateFees) {
    const m = lf.periodKey?.match(/^(.+)\+d(\d+)$/);
    if (!m) continue;
    const cur = dailyPosted.get(m[1]) ?? { lastDay: 0, totalCents: 0n };
    cur.lastDay = Math.max(cur.lastDay, Number(m[2]));
    cur.totalCents += lf.amountCents;
    dailyPosted.set(m[1], cur);
  }
  const reversedIds = new Set(
    allocations.map((a) => a.reversesAllocationId).filter((x): x is string => !!x),
  );
  const allocated: Record<string, bigint> = {};
  for (const a of allocations) {
    if (a.reversesAllocationId) continue;
    if (reversedIds.has(a.id)) continue;
    allocated[a.chargeEntryId] = (allocated[a.chargeEntryId] ?? 0n) + a.amountCents;
  }
  // Effective (waiver-netted) amount per rent charge — same pure netting the
  // snapshot loaders use. Reversals pointing at non-charges are ignored.
  const effectiveAmountByCharge = new Map(
    netReversalsIntoCharges(
      rentCharges.map((c) => ({
        entryId: c.id,
        amountCents: c.amountCents,
        dueDate: c.effectiveDate,
      })),
      reversals,
    ).map((c) => [c.entryId, c.amountCents] as const),
  );

  let created = 0;
  for (const ch of rentCharges) {
    if (!ch.periodKey) continue;
    const effectiveCents = effectiveAmountByCharge.get(ch.id) ?? ch.amountCents;
    const outstanding = effectiveCents - (allocated[ch.id] ?? 0n);
    if (outstanding <= 0n) continue;
    if (now <= graceDeadline(ch.effectiveDate, lease.gracePeriodDays, tz)) continue;

    if (lease.lateFeeType === "daily") {
      // A one-shot fee on this period means it was already assessed under a
      // previous policy — never stack the daily shape on top of it.
      if (lateFeePeriods.has(ch.periodKey)) continue;
      // One row per day past grace ("$10/day after the first 5 days"),
      // idempotent via a per-day period key; accrual resumes after the
      // highest posted day and stops once the charge is paid (outstanding
      // check above) or the cap — measured against the POSTED total — is hit.
      const posted = dailyPosted.get(ch.periodKey);
      const accruals = dailyLateFeeAccruals({
        dueDate: ch.effectiveDate,
        graceDays: lease.gracePeriodDays,
        tz,
        now,
        dailyRateCents: lease.lateFeeAmountCents ?? 0n,
        capCents: lease.lateFeeMaxCents,
        fromDay: posted?.lastDay ?? 0,
        alreadyAccruedCents: posted?.totalCents ?? 0n,
      });
      for (const a of accruals) {
        const dayKey = dailyLateFeePeriodKey(ch.periodKey, a.day);
        if (lateFeePeriods.has(dayKey)) continue;
        try {
          await prisma.ledgerEntry.create({
            data: {
              leaseId: lease.id,
              tenantId: lease.tenantId,
              entryType: "late_fee",
              amountCents: a.amountCents,
              periodKey: dayKey,
              effectiveDate: a.accruedOn,
              sourceType: "late_fee",
              description: `Late fee day ${a.day} for ${ch.periodKey}`,
            },
          });
          created++;
        } catch (e) {
          if (isUniqueViolation(e)) continue;
          throw e;
        }
      }
      continue;
    }

    if (lateFeePeriods.has(ch.periodKey)) continue;
    // Daily rows already posted for this period (under a previous policy)
    // mean it was assessed — never stack a one-shot fee on top.
    if (dailyPosted.has(ch.periodKey)) continue;
    const fee = computeLateFeeCents({
      type: lease.lateFeeType,
      // Percentage fees price off the effective (waiver-netted) charge.
      rentChargeCents: effectiveCents,
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
  /** Leases that threw and were skipped this run (isolated, not fatal). */
  failed: number;
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
  let failed = 0;
  for (const lease of leases) {
    const tz = lease.unit.property.timezone;
    try {
      chargesCreated += await generateChargesForLease(lease, tz, now);
      lateFeesCreated += await assessLateFeesForLease(lease, tz, now);
    } catch (e) {
      // Isolate per lease: one bad lease (e.g. an invalid property timezone →
      // Luxon "Invalid DateTime") must not abort billing for the rest of the
      // portfolio. Idempotency means a fixed lease back-fills on the next run.
      failed++;
      console.error(`[billing] lease ${lease.id} failed:`, e);
    }
  }
  // After charging, so back-filled periods keep their historical pricing.
  const rentIncreasesApplied = await applyScheduledRentIncreases(now);
  return {
    leasesProcessed: leases.length,
    chargesCreated,
    lateFeesCreated,
    failed,
    rentIncreasesApplied,
  };
}
