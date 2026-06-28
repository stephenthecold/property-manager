import { type Cents } from "@/lib/money";

/**
 * Pure (DB-free) helpers for the self-report → confirm payment lifecycle and the
 * balance-safety invariant it must preserve.
 *
 * The ledger — not the Payment table — is the source of truth: a lease's balance
 * is SUM(amountCents) over its LedgerEntry rows. A Payment row affects that
 * balance ONLY through the negative `payment` LedgerEntry that posting creates.
 * Therefore:
 *
 *   - a `pending` self-reported payment writes NO LedgerEntry => it cannot move
 *     the balance, no matter its amount;
 *   - `posted` is the only status that has a backing ledger entry;
 *   - `voided` keeps its original entry but is fully offset by a reversal entry
 *     (net zero), and a rejected self-report never had an entry at all.
 *
 * These predicates let the service + tests reason about that invariant without a
 * database. `summarizeReportedForBalance` is the assertion the unit test pins:
 * pending self-reports contribute 0 to the balance; confirming posts exactly the
 * payment's negative amount, once.
 */

/** Payment lifecycle states (mirrors the Prisma PaymentStatus enum). */
export type PaymentLifecycle = "pending" | "posted" | "voided" | "reversed";

/**
 * Whether a payment in this status has a live, balance-reducing ledger entry.
 * Only `posted` does. `pending` (incl. an unconfirmed self-report) and `voided`
 * (offset by a reversal) do not move the balance.
 */
export function isBalanceAffecting(status: PaymentLifecycle): boolean {
  return status === "posted";
}

/** A payment may transition pending -> posted (confirm) only from `pending`. */
export function canConfirm(status: PaymentLifecycle): boolean {
  return status === "pending";
}

/** A self-report may be rejected (-> voided) only while still `pending`. */
export function canReject(status: PaymentLifecycle): boolean {
  return status === "pending";
}

export interface ReportedPaymentLike {
  status: PaymentLifecycle;
  /** Positive amount the payment is/was for (cents). */
  amountCents: Cents;
}

/**
 * The total balance impact (in cents, as a negative number for money received)
 * of a set of payments given their statuses — counting ONLY the ones that have
 * a live ledger entry (posted). This is exactly what the ledger sum already
 * reflects; pending self-reports add nothing. Used to prove the invariant in a
 * DB-free unit test.
 */
export function balanceImpactOfPayments(
  payments: readonly ReportedPaymentLike[],
): Cents {
  let impact = 0n;
  for (const p of payments) {
    if (isBalanceAffecting(p.status)) impact -= p.amountCents;
  }
  return impact;
}
