import { type Cents } from "@/lib/money";
import { graceDeadline } from "@/lib/accounting/periods";

/**
 * Pure status derivation with a strict precedence: vacant > no_active_lease >
 * financial. Every comparison stays in the SAME scope — the financial statuses
 * are about the CURRENT PERIOD (not the global multi-period balance), so a tenant
 * with old arrears isn't mislabeled. Global arrears are surfaced separately.
 */

export type UnitOccupancy =
  | "vacant"
  | "occupied"
  | "maintenance"
  | "unavailable";

export type AccountStatus =
  | "vacant"
  | "no_active_lease"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "due_soon";

export interface StatusInput {
  occupancy: UnitOccupancy;
  hasActiveLease: boolean;
  /** Outstanding on the current period's charge(s). */
  currentPeriodOutstandingCents: Cents;
  /** Amount applied to the current period. */
  currentPeriodPaidCents: Cents;
  currentPeriodDueDate: Date | null;
  gracePeriodDays: number;
  tz: string;
  now: Date;
}

export function deriveStatus(input: StatusInput): AccountStatus {
  if (input.occupancy === "vacant") return "vacant";
  if (!input.hasActiveLease) return "no_active_lease";

  if (input.currentPeriodOutstandingCents <= 0n) return "paid";

  const overdue =
    input.currentPeriodDueDate != null &&
    input.now >
      graceDeadline(
        input.currentPeriodDueDate,
        input.gracePeriodDays,
        input.tz,
      );
  if (overdue) return "overdue";

  if (input.currentPeriodPaidCents > 0n) return "partially_paid";
  return "due_soon";
}
