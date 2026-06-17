import { type Cents, sumCents } from "@/lib/money";

/**
 * Pure logic for rent splits / subsidy expectations. A RentShare says "this much
 * of the monthly rent is expected from this party" (payerId null = the tenant's
 * portion). This is an EXPECTATION overlay only — it never posts ledger entries
 * or affects balances/allocation; the ledger still carries the whole rent as one
 * charge. DB-free and unit-tested. The map key "" stands for the tenant (null
 * payer) so expected/received can be compared with one keyspace.
 */

export const TENANT_KEY = "" as const;

export interface RentShareInput {
  /** null = the tenant's portion. */
  payerId: string | null;
  label: string;
  amountCents: Cents;
  effectiveDate: Date;
  /** Exclusive; null = open-ended. */
  endDate: Date | null;
}

/** Map key for a share's payer ("" = tenant). */
export function payerKey(payerId: string | null): string {
  return payerId ?? TENANT_KEY;
}

/** Shares in force at `asOf` (effectiveDate <= asOf < endDate). */
export function sharesEffectiveAt(
  shares: readonly RentShareInput[],
  asOf: Date,
): RentShareInput[] {
  const t = asOf.getTime();
  return shares.filter(
    (s) =>
      s.effectiveDate.getTime() <= t &&
      (s.endDate == null || t < s.endDate.getTime()),
  );
}

/** Total expected monthly amount across the given shares. */
export function sharesTotalCents(shares: readonly RentShareInput[]): Cents {
  return sumCents(shares.map((s) => s.amountCents));
}

/** Expected amount grouped by payer (key "" = tenant). */
export function expectedByPayer(
  shares: readonly RentShareInput[],
): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const s of shares) {
    const key = payerKey(s.payerId);
    out.set(key, (out.get(key) ?? 0n) + s.amountCents);
  }
  return out;
}

/**
 * Whether the split sums exactly to the expected monthly charge. Display-only
 * (a mismatch is a config warning, never a balance correction).
 */
export function splitMatchesExpected(
  shares: readonly RentShareInput[],
  expectedMonthlyCents: Cents,
): boolean {
  return sharesTotalCents(shares) === expectedMonthlyCents;
}

export interface PayerExpectation {
  payerId: string | null;
  expectedCents: Cents;
  receivedCents: Cents;
  /** Shortfall, floored at 0 (overpayment is not "missing"). */
  missingCents: Cents;
}

/**
 * Reconcile expected-per-payer against received-per-payer for a period. Both
 * keyed by {@link payerKey} ("" = tenant). `missingCents` is the positive
 * shortfall — e.g. a housing authority's HAP that hasn't arrived this month.
 */
export function reconcileExpectations(
  shares: readonly RentShareInput[],
  receivedByPayer: ReadonlyMap<string, Cents>,
): PayerExpectation[] {
  const out: PayerExpectation[] = [];
  for (const [key, expectedCents] of expectedByPayer(shares)) {
    const receivedCents = receivedByPayer.get(key) ?? 0n;
    const shortfall = expectedCents - receivedCents;
    out.push({
      payerId: key === TENANT_KEY ? null : key,
      expectedCents,
      receivedCents,
      missingCents: shortfall > 0n ? shortfall : 0n,
    });
  }
  return out;
}
