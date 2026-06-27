import type { MaintenanceJobStatus } from "@/lib/generated/prisma/enums";
import { TONE_CLASS, type Tone } from "@/lib/ui/status-tone";

/**
 * Pure helpers for the maintenance-job lifecycle. Display/label/classification
 * only — DB-free and unit-friendly. The money/completion logic (costCents ->
 * PropertyExpense mirroring) lives in the actions and is NOT touched here.
 */

/** Lifecycle order shown in selects and used for grouping/sorting. */
export const MAINTENANCE_STATUSES: MaintenanceJobStatus[] = [
  "pending",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "canceled",
];

/**
 * The non-terminal states — a job is still "open" work in these. Also the set
 * a manager may move a job between via the status control (completed has its
 * own cost-capturing flow; canceled is offered alongside as the terminate
 * option).
 */
export const OPEN_STATUSES: MaintenanceJobStatus[] = [
  "pending",
  "assigned",
  "in_progress",
  "on_hold",
];

const LABELS: Record<MaintenanceJobStatus, string> = {
  pending: "Pending",
  assigned: "Assigned",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  canceled: "Canceled",
};

/** Status -> badge tone, drawn from the shared tone source so lifecycle pills
 *  stay in lockstep with the rest of the app. */
const STATUS_TONE: Record<MaintenanceJobStatus, Tone> = {
  pending: "warning",
  assigned: "info",
  in_progress: "progress",
  on_hold: "hold",
  completed: "success",
  canceled: "neutral",
};

export function parseMaintenanceStatus(
  raw: string | null | undefined,
): MaintenanceJobStatus | null {
  return raw != null && raw in LABELS ? (raw as MaintenanceJobStatus) : null;
}

export function statusLabel(s: MaintenanceJobStatus): string {
  return LABELS[s];
}

/** Tailwind classes for a status badge (theme-safe). */
export function statusBadgeClass(s: MaintenanceJobStatus): string {
  return TONE_CLASS[STATUS_TONE[s]];
}

/**
 * True for non-terminal states {pending, assigned, in_progress, on_hold};
 * false for terminal {completed, canceled}. Use this everywhere a job being
 * "open" matters (overdue math, open-job counts, reminder eligibility) instead
 * of comparing to the literal "pending".
 */
export function isOpenStatus(s: MaintenanceJobStatus): boolean {
  return OPEN_STATUSES.includes(s);
}
