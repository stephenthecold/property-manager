import { type Cents, minCents, sumCents } from "@/lib/money";
import { daysBetween } from "@/lib/accounting/periods";

/**
 * Strict per-charge FIFO allocation. A payment is applied to open charges
 * oldest-first; whatever is left over becomes available tenant credit. All pure
 * — the DB layer persists the returned plan as ChargeAllocation rows.
 *
 * Charges and allocations are append-only; a reversed allocation is represented
 * by netting (callers pass the net, non-reversed allocated amount per charge).
 */

export interface ChargeInput {
  entryId: string;
  /** Positive amount that was charged. */
  amountCents: Cents;
  /** Due date (drives FIFO order and aging). */
  dueDate: Date;
}

export interface OpenCharge {
  entryId: string;
  dueDate: Date;
  /** Remaining unpaid amount (positive). */
  outstandingCents: Cents;
}

/** Map of chargeEntryId -> net allocated cents (non-reversed). */
export type AllocatedByCharge = Record<string, Cents>;

/** A `reversal` ledger row that offsets part (or all) of another entry. */
export interface ChargeReversalInput {
  /** Negative amount that offsets the target entry. */
  amountCents: Cents;
  /** Ledger entry id the reversal points at (charge waives target a charge). */
  reversesEntryId: string | null;
}

/**
 * Net waiver reversals into the charges they target: a charge's effective
 * amount = original + sum(reversals pointing at it) (reversal amounts are
 * negative). Reversals that target anything other than one of `charges`
 * (e.g. payment-void reversals) are ignored. Feed the result to
 * {@link computeOpenCharges} so the waived portion stops aging, FIFO payment
 * allocation, overdue reminders, and late-fee accrual.
 */
export function netReversalsIntoCharges(
  charges: readonly ChargeInput[],
  reversals: readonly ChargeReversalInput[],
): ChargeInput[] {
  if (reversals.length === 0) return [...charges];
  const reversedByTarget = new Map<string, Cents>();
  for (const r of reversals) {
    if (!r.reversesEntryId) continue;
    reversedByTarget.set(
      r.reversesEntryId,
      (reversedByTarget.get(r.reversesEntryId) ?? 0n) + r.amountCents,
    );
  }
  return charges.map((c) => ({
    ...c,
    amountCents: c.amountCents + (reversedByTarget.get(c.entryId) ?? 0n),
  }));
}

/** Compute outstanding-per-charge and return only open charges, oldest-first. */
export function computeOpenCharges(
  charges: readonly ChargeInput[],
  allocated: AllocatedByCharge,
): OpenCharge[] {
  return charges
    .map((c) => ({
      entryId: c.entryId,
      dueDate: c.dueDate,
      outstandingCents: c.amountCents - (allocated[c.entryId] ?? 0n),
    }))
    .filter((c) => c.outstandingCents > 0n)
    .sort((a, b) => {
      const t = a.dueDate.getTime() - b.dueDate.getTime();
      return t !== 0 ? t : a.entryId.localeCompare(b.entryId);
    });
}

export interface AllocationLine {
  chargeEntryId: string;
  amountCents: Cents;
}

export interface AllocationPlan {
  allocations: AllocationLine[];
  /** Unapplied remainder of the payment — becomes tenant credit. */
  leftoverCents: Cents;
}

/** Apply `amount` across open charges oldest-first. */
export function planFifoAllocation(
  amount: Cents,
  openCharges: readonly OpenCharge[],
): AllocationPlan {
  let remaining = amount;
  const allocations: AllocationLine[] = [];
  for (const c of openCharges) {
    if (remaining <= 0n) break;
    if (c.outstandingCents <= 0n) continue;
    const applied = minCents(remaining, c.outstandingCents);
    allocations.push({ chargeEntryId: c.entryId, amountCents: applied });
    remaining -= applied;
  }
  return { allocations, leftoverCents: remaining };
}

export interface AgingBuckets {
  current: Cents; // not yet past due
  d1_30: Cents;
  d31_60: Cents;
  d61_90: Cents;
  d90plus: Cents;
  total: Cents;
}

/** Bucket open-charge outstanding by how many days past due, in the property tz. */
export function agingFromOpenCharges(
  openCharges: readonly OpenCharge[],
  now: Date,
  tz: string,
): AgingBuckets {
  const buckets: AgingBuckets = {
    current: 0n,
    d1_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90plus: 0n,
    total: 0n,
  };
  for (const c of openCharges) {
    const daysPast = daysBetween(c.dueDate, now, tz);
    if (daysPast <= 0) buckets.current += c.outstandingCents;
    else if (daysPast <= 30) buckets.d1_30 += c.outstandingCents;
    else if (daysPast <= 60) buckets.d31_60 += c.outstandingCents;
    else if (daysPast <= 90) buckets.d61_90 += c.outstandingCents;
    else buckets.d90plus += c.outstandingCents;
  }
  buckets.total = sumCents([
    buckets.current,
    buckets.d1_30,
    buckets.d31_60,
    buckets.d61_90,
    buckets.d90plus,
  ]);
  return buckets;
}
