import type { InspectionChecklistStatus } from "@/lib/generated/prisma/enums";

/**
 * Pure helpers for inspection CHECKLIST items (DB-free, unit-tested). A checklist
 * item is a condition observation (pass/fail/na/pending) that can also carry an
 * optional move-out deposit-deduction amount. None of this touches the ledger.
 */

export const CHECKLIST_STATUSES: InspectionChecklistStatus[] = [
  "pending",
  "pass",
  "fail",
  "na",
];

const STATUS_LABELS: Record<InspectionChecklistStatus, string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
};

export function checklistStatusLabel(s: InspectionChecklistStatus): string {
  return STATUS_LABELS[s];
}

export function isChecklistStatus(v: string): v is InspectionChecklistStatus {
  return (CHECKLIST_STATUSES as readonly string[]).includes(v);
}

export function parseChecklistStatus(
  raw: string | null | undefined,
  fallback: InspectionChecklistStatus = "pending",
): InspectionChecklistStatus {
  return raw != null && isChecklistStatus(raw) ? raw : fallback;
}

/** Tailwind classes for a status pill — every tint carries a dark: variant. */
export function checklistStatusClass(s: InspectionChecklistStatus): string {
  switch (s) {
    case "pass":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "fail":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    case "na":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  }
}

export interface ChecklistTally {
  total: number;
  pass: number;
  fail: number;
  na: number;
  pending: number;
}

/** Count items by status for the report summary. */
export function tallyChecklist(
  items: readonly { status: InspectionChecklistStatus }[],
): ChecklistTally {
  const t: ChecklistTally = { total: items.length, pass: 0, fail: 0, na: 0, pending: 0 };
  for (const i of items) t[i.status]++;
  return t;
}

/** Sum the deduction amounts across checklist items (the move-out disposition). */
export function sumChecklistDeductions(
  items: readonly { amountCents: bigint }[],
): bigint {
  return items.reduce((sum, i) => sum + i.amountCents, 0n);
}
