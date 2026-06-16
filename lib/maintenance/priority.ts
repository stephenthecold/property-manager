import type { MaintenancePriority } from "@/lib/generated/prisma/enums";

/**
 * Pure helpers for maintenance-job triage priority. Display/sort only — priority
 * never gates whether work happens. DB-free and unit-tested.
 */

/** Highest urgency first — the order shown in selects and used for sorting. */
export const MAINTENANCE_PRIORITIES: MaintenancePriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
];

const RANK: Record<MaintenancePriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const LABELS: Record<MaintenancePriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export function parseMaintenancePriority(
  raw: string | null | undefined,
): MaintenancePriority {
  return raw != null && raw in RANK
    ? (raw as MaintenancePriority)
    : "normal";
}

export function priorityLabel(p: MaintenancePriority): string {
  return LABELS[p];
}

/** Sort comparator: most urgent first, stable for equal priorities. */
export function comparePriority(
  a: MaintenancePriority,
  b: MaintenancePriority,
): number {
  return RANK[a] - RANK[b];
}
