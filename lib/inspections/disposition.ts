import type { InspectionType, InspectionStatus } from "@/lib/generated/prisma/enums";

/**
 * Pure inspection/deposit-disposition helpers (DB-free, unit-tested). Money is
 * integer cents (bigint). A move-out deposit disposition takes the lease's
 * REFUNDABLE deposit (total deposit − the non-refundable portion) and subtracts
 * itemized deductions; whatever's left is refunded, and any excess is a balance
 * the tenant owes. None of this touches the ledger — deposits are LeaseDeposit
 * operating records, not tenant balances.
 */

export const INSPECTION_TYPES: InspectionType[] = [
  "move_in",
  "move_out",
  "routine",
  "other",
];

const TYPE_LABELS: Record<InspectionType, string> = {
  move_in: "Move-in",
  move_out: "Move-out",
  routine: "Routine",
  other: "Other",
};

const STATUS_LABELS: Record<InspectionStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  canceled: "Canceled",
};

export function inspectionTypeLabel(t: InspectionType): string {
  return TYPE_LABELS[t];
}

export function inspectionStatusLabel(s: InspectionStatus): string {
  return STATUS_LABELS[s];
}

export function isInspectionType(v: string): v is InspectionType {
  return (INSPECTION_TYPES as readonly string[]).includes(v);
}

export function parseInspectionType(
  raw: string | null | undefined,
  fallback: InspectionType = "routine",
): InspectionType {
  return raw != null && isInspectionType(raw) ? raw : fallback;
}

export interface DepositDisposition {
  /** Sum of all deposits on the lease. */
  depositTotalCents: bigint;
  /** Portion explicitly non-refundable. */
  nonRefundableCents: bigint;
  /** depositTotal − nonRefundable, floored at 0. */
  refundableCents: bigint;
  /** Sum of itemized deductions. */
  deductionsCents: bigint;
  /** What the tenant gets back: refundable − deductions, floored at 0. */
  refundCents: bigint;
  /** What the tenant still owes when deductions exceed the refundable deposit. */
  balanceOwedCents: bigint;
}

const max0 = (v: bigint): bigint => (v > 0n ? v : 0n);

export function computeDisposition(i: {
  depositTotalCents: bigint;
  nonRefundableCents: bigint;
  deductionsCents: bigint;
}): DepositDisposition {
  const refundableCents = max0(i.depositTotalCents - i.nonRefundableCents);
  const refundCents = max0(refundableCents - i.deductionsCents);
  const balanceOwedCents = max0(i.deductionsCents - refundableCents);
  return {
    depositTotalCents: i.depositTotalCents,
    nonRefundableCents: i.nonRefundableCents,
    refundableCents,
    deductionsCents: i.deductionsCents,
    refundCents,
    balanceOwedCents,
  };
}
