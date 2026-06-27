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

/**
 * Hand off an accepted SUCCESSOR renewal once the prior lease's term has passed:
 * END the prior lease and ACTIVATE the (draft) successor lease — in ONE
 * transaction so the "one active lease per unit" invariant is never momentarily
 * violated (the prior lease is ended before the successor is activated).
 * Idempotent (compare-and-swap on each status) and audited.
 */
export async function endRenewedLeases(now: Date): Promise<number> {
  const offers = await prisma.leaseRenewalOffer.findMany({
    where: {
      status: "accepted",
      renewalModel: "successor",
      successorLeaseId: { not: null },
      lease: { status: "active", endDate: { lt: now } },
    },
    select: { id: true, leaseId: true, successorLeaseId: true },
  });

  let handed = 0;
  for (const offer of offers) {
    try {
      // Isolate per offer: one stuck handoff must not abort the rest of the run
      // (nor the expiry sweep that follows in runBilling).
      const ok = await prisma.$transaction(async (tx) => {
        // End the prior lease first, freeing the unit.
        const endRes = await tx.lease.updateMany({
          where: { id: offer.leaseId, status: "active" },
          data: { status: "ended" },
        });
        if (endRes.count === 0) return false; // handed off elsewhere / status changed
        // Then activate the successor (draft -> active): same tx, so at no
        // committed point are two leases active on the unit. If the successor is
        // no longer a clean draft (e.g. it was terminated), DON'T leave the prior
        // lease ended with nothing to replace it — throw to roll the whole tx
        // back, keeping the prior lease active. It surfaces in the log and is
        // retried next run rather than silently vacating the unit.
        const actRes = await tx.lease.updateMany({
          where: { id: offer.successorLeaseId!, status: "draft" },
          data: { status: "active" },
        });
        if (actRes.count !== 1) {
          throw new Error(
            `handoff abort: successor ${offer.successorLeaseId} not draft ` +
              `(activated ${actRes.count}); prior lease ${offer.leaseId} kept active`,
          );
        }
        await writeAudit(tx, {
          actorType: "system",
          action: "lease.renewal_handoff",
          entityType: "Lease",
          entityId: offer.leaseId,
          after: {
            reason: "successor_renewal",
            offerId: offer.id,
            endedLeaseId: offer.leaseId,
            activatedLeaseId: offer.successorLeaseId,
          },
        });
        return true;
      });
      if (ok) handed++;
    } catch (e) {
      console.error(`[renewal] handoff failed for offer ${offer.id}:`, e);
    }
  }
  return handed;
}

/**
 * Expire renewal offers still "sent" whose e-sign window has closed (the request
 * is past its expiry, or gone) without completion — so a stale offer stops
 * wedging the one-open-offer guard. A "completed" or "canceled" request is left
 * alone (handled by acceptance / cancellation). Idempotent + audited.
 */
export async function expireLapsedRenewalOffers(now: Date): Promise<number> {
  const sent = await prisma.leaseRenewalOffer.findMany({
    where: { status: "sent", signingRequestId: { not: null } },
    select: { id: true, signingRequestId: true },
  });
  if (sent.length === 0) return 0;
  const requests = await prisma.signingRequest.findMany({
    where: { id: { in: sent.map((o) => o.signingRequestId!) } },
    select: { id: true, status: true, expiresAt: true },
  });
  const byId = new Map(requests.map((r) => [r.id, r]));

  let expired = 0;
  for (const offer of sent) {
    const req = byId.get(offer.signingRequestId!);
    // Lapsed = the linked request is gone, or still "sent" but past its expiry.
    const lapsed = !req || (req.status === "sent" && req.expiresAt < now);
    if (!lapsed) continue;
    try {
      const ok = await prisma.$transaction(async (tx) => {
        const res = await tx.leaseRenewalOffer.updateMany({
          where: { id: offer.id, status: "sent" },
          data: { status: "expired" },
        });
        if (res.count === 0) return false;
        await writeAudit(tx, {
          actorType: "system",
          action: "renewal.offer_expired",
          entityType: "LeaseRenewalOffer",
          entityId: offer.id,
        });
        return true;
      });
      if (ok) expired++;
    } catch (e) {
      console.error(`[renewal] expire failed for offer ${offer.id}:`, e);
    }
  }
  return expired;
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
  /** Prior leases of accepted successor renewals ended now that their term passed. */
  leasesEndedAfterRenewal: number;
  /** Renewal offers expired because their e-sign window lapsed unsigned. */
  renewalOffersExpired: number;
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
  // Renewal housekeeping: end prior leases whose successor term has begun, and
  // expire offers whose signing window lapsed unsigned.
  const leasesEndedAfterRenewal = await endRenewedLeases(now);
  const renewalOffersExpired = await expireLapsedRenewalOffers(now);
  return {
    leasesProcessed: leases.length,
    chargesCreated,
    lateFeesCreated,
    failed,
    rentIncreasesApplied,
    leasesEndedAfterRenewal,
    renewalOffersExpired,
  };
}
