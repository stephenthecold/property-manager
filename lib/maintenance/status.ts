import type { MaintenanceJobStatus } from "@/lib/generated/prisma/enums";

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

/** Themed badge tints per status (every tint carries a dark: variant). */
const BADGE: Record<MaintenanceJobStatus, string> = {
  pending:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  assigned:
    "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  in_progress:
    "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  on_hold:
    "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
  completed:
    "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  canceled: "border-muted bg-muted text-muted-foreground",
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
  return BADGE[s];
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
