import type { Cents } from "@/lib/money";

/**
 * Pure move-out deposit-disposition math (DB-free, unit-tested). Given the
 * lease's current ledger balance, the refundable deposit held, and itemized
 * move-out deductions (damages/cleaning/etc.), it decides how much deposit is
 * applied, what the tenant still owes, and what cash is refunded.
 *
 * Money is integer cents (bigint). Sign convention follows the ledger:
 * `balanceCents` is + when the tenant owes, − when they hold a standing credit.
 * The service bridges this to ledger postings (damages as a positive
 * `adjustment`, the applied deposit as a negative `credit`); this module never
 * touches the DB.
 */

export interface DepositDeduction {
  label: string;
  /** Positive cents; non-positive lines are ignored. */
  amountCents: Cents;
}

export interface DispositionInput {
  /** Lease ledger balance = SUM(LedgerEntry.amountCents): + owed, − credit. */
  balanceCents: Cents;
  /** Refundable deposit held (base security deposit + refundable extras). */
  depositHeldCents: Cents;
  /** Itemized move-out deductions (damages, cleaning, …). */
  deductions: DepositDeduction[];
}

export interface DispositionResult {
  /** Sum of the (positive) deduction lines — the damage chargeback total. */
  damagesTotalCents: Cents;
  /** balance + damages: what the tenant owes before the deposit (may be < 0). */
  claimCents: Cents;
  /** Deposit applied against the claim (0 ≤ applied ≤ deposit held). */
  depositAppliedCents: Cents;
  /** Cash to return to the tenant: unused deposit + any standing credit. */
  refundDueCents: Cents;
  /** What the tenant still owes after the deposit is applied (≥ 0). */
  balanceOwedCents: Cents;
}

const max = (a: Cents, b: Cents): Cents => (a > b ? a : b);
const min = (a: Cents, b: Cents): Cents => (a < b ? a : b);

export function computeDisposition(input: DispositionInput): DispositionResult {
  const damagesTotalCents = input.deductions.reduce(
    (sum, d) => sum + max(0n, d.amountCents),
    0n,
  );
  const claimCents = input.balanceCents + damagesTotalCents;
  const held = max(0n, input.depositHeldCents);

  // Deposit only offsets a positive claim; a net credit isn't "covered" by it.
  const positiveClaim = max(0n, claimCents);
  const depositAppliedCents = min(held, positiveClaim);
  const balanceOwedCents = positiveClaim - depositAppliedCents; // ≥ 0

  // Refund = the deposit not used + any standing credit (the negative claim).
  const unusedDeposit = held - depositAppliedCents;
  const standingCredit = max(0n, -claimCents);
  const refundDueCents = unusedDeposit + standingCredit;

  return {
    damagesTotalCents,
    claimCents,
    depositAppliedCents,
    refundDueCents,
    balanceOwedCents,
  };
}

export type DispositionValidation = { ok: true } | { ok: false; error: string };

export function validateDeductions(
  deductions: DepositDeduction[],
): DispositionValidation {
  for (const d of deductions) {
    if (!d.label.trim()) return { ok: false, error: "Every deduction needs a label." };
    if (d.amountCents <= 0n) {
      return { ok: false, error: `Deduction "${d.label}" must be a positive amount.` };
    }
  }
  return { ok: true };
}
