import type { MaintenanceJobStatus } from "@/lib/generated/prisma/enums";
import { isOpenStatus } from "@/lib/maintenance/status";

/**
 * Pure SLA/due math for maintenance jobs. Clock-injected (`now`) and DB-free —
 * it decides only how to *display* a due date relative to the job's lifecycle.
 * No money, no ledger, no side effects.
 *
 * dueDate is a date-only value stored at UTC midnight (the page renders it with
 * timeZone:"UTC"), so we compare whole UTC days to keep the boundary stable
 * regardless of the server's local zone.
 */

export type SlaState = "overdue" | "due_soon" | "on_track" | "none";

export interface SlaResult {
  state: SlaState;
  /** Whole UTC days from `now` to the due date; null when there's no dueDate. */
  daysUntilDue: number | null;
}

/** A job is "due soon" when it's due within this many days (inclusive). */
const DUE_SOON_DAYS = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Start-of-UTC-day epoch ms for a Date. */
function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Classify a job's SLA standing.
 * - Terminal statuses (completed/canceled) or no dueDate -> "none".
 * - dueDate in the past (by whole UTC days) -> "overdue".
 * - due within DUE_SOON_DAYS days -> "due_soon".
 * - otherwise -> "on_track".
 */
export function slaState(i: {
  status: MaintenanceJobStatus;
  dueDate: Date | null;
  now: Date;
}): SlaResult {
  if (!isOpenStatus(i.status) || i.dueDate == null) {
    return { state: "none", daysUntilDue: null };
  }
  const daysUntilDue = Math.round(
    (utcDayStart(i.dueDate) - utcDayStart(i.now)) / MS_PER_DAY,
  );
  if (daysUntilDue < 0) return { state: "overdue", daysUntilDue };
  if (daysUntilDue <= DUE_SOON_DAYS) return { state: "due_soon", daysUntilDue };
  return { state: "on_track", daysUntilDue };
}
