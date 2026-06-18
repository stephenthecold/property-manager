/**
 * Pure, DB-free merge for the per-tenant unified activity timeline.
 *
 * The data services build one `ActivityEvent[]` per source (payments, ledger,
 * reminders, notices, requests, maintenance, audit) and hand the groups here to
 * be flattened into a single newest-first feed. Keeping the merge pure means it
 * is deterministic and unit-testable with no Prisma/clock dependency.
 */

/** Coarse category for an activity event — drives the timeline's dot colour. */
export type ActivityKind =
  | "payment"
  | "charge"
  | "reminder"
  | "notice"
  | "request"
  | "maintenance"
  | "audit";

export interface ActivityEvent {
  /** Stable, source-prefixed id (e.g. "payment:ckxyz") — unique across groups. */
  id: string;
  /** When the event happened (economic/effective date where one exists). */
  at: Date;
  kind: ActivityKind;
  /** One-line headline (e.g. "Payment recorded · $1,250.00"). */
  title: string;
  /** Optional muted second line (status, period, free-text note, …). */
  detail?: string;
  /** Optional deep-link to a detail page (omit when no page exists). */
  href?: string;
}

/**
 * Flatten the per-source groups into a single feed sorted by `at` descending
 * (newest first). Ties (identical timestamps) break by `id` ascending so the
 * order is fully deterministic. Pure: no mutation of the inputs.
 */
export function mergeActivity(groups: ActivityEvent[][]): ActivityEvent[] {
  // `flat()` returns a fresh array, so the in-place `sort()` never touches the
  // caller's input groups.
  return groups.flat().sort((a, b) => {
    const delta = b.at.getTime() - a.at.getTime();
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
