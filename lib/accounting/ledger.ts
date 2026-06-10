import { absCents, type Cents, maxCents, sumCents } from "@/lib/money";

/**
 * Pure ledger selectors. The ledger is append-only: the net balance is the sum of
 * `amountCents` over ALL physical rows for a lease — there is NO void filter. A
 * correction is an offsetting `reversal` row, so the sum self-corrects and history
 * is never mutated. (This is the resolution to the void/reversal double-count risk.)
 *
 * Sign convention: + increases what the tenant owes (rent_charge, late_fee),
 * - decreases it (payment, credit). balance > 0 => owes; balance < 0 => credit.
 */

export type LedgerEntryType =
  | "rent_charge"
  | "payment"
  | "late_fee"
  | "adjustment"
  | "credit"
  | "reversal";

export interface LedgerEntryInput {
  id: string;
  entryType: LedgerEntryType;
  amountCents: Cents; // signed
  effectiveDate: Date;
  periodKey?: string | null;
}

/** Net balance for a lease. Positive = tenant owes; negative = tenant holds credit. */
export function netBalanceCents(entries: readonly LedgerEntryInput[]): Cents {
  return sumCents(entries.map((e) => e.amountCents));
}

/** Amount the tenant owes (never negative). */
export function totalOwedCents(entries: readonly LedgerEntryInput[]): Cents {
  return maxCents(0n, netBalanceCents(entries));
}

/** Credit the tenant holds from overpayment (never negative). */
export function tenantCreditCents(entries: readonly LedgerEntryInput[]): Cents {
  return maxCents(0n, -netBalanceCents(entries));
}

/** The most recent payment entry (entryType 'payment'), or null. */
export function lastPayment(
  entries: readonly LedgerEntryInput[],
): LedgerEntryInput | null {
  let latest: LedgerEntryInput | null = null;
  for (const e of entries) {
    if (e.entryType !== "payment") continue;
    if (!latest || e.effectiveDate > latest.effectiveDate) latest = e;
  }
  return latest;
}

export function lastPaymentDate(
  entries: readonly LedgerEntryInput[],
): Date | null {
  return lastPayment(entries)?.effectiveDate ?? null;
}

/** Whole days since the last payment, or null if none. */
export function daysSinceLastPayment(
  entries: readonly LedgerEntryInput[],
  now: Date,
): number | null {
  const d = lastPaymentDate(entries);
  if (!d) return null;
  const ms = now.getTime() - d.getTime();
  return Math.floor(ms / 86_400_000);
}

/** Sum of payments (as a positive number) applied within a given period hint. */
export function paidForPeriodCents(
  entries: readonly LedgerEntryInput[],
  periodKey: string,
): Cents {
  return absCents(
    sumCents(
      entries
        .filter((e) => e.entryType === "payment" && e.periodKey === periodKey)
        .map((e) => e.amountCents),
    ),
  );
}
