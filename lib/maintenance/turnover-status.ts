import type { TurnoverChecklistStatus } from "@/lib/generated/prisma/enums";
import { TONE_CLASS, type Tone } from "@/lib/ui/status-tone";

/**
 * Pure helpers for the unit make-ready (turnover) checklist lifecycle. Mirrors
 * lib/maintenance/status.ts: display/label/classification + the open/terminal
 * test, all DB-free and unit-friendly. Use `isTurnoverOpen()` / `OPEN_TURNOVER_STATUSES`
 * everywhere "is this turnover still being worked?" matters — never compare a
 * status string literal inline.
 */

/** Lifecycle order shown in selects and used for grouping/sorting. */
export const TURNOVER_STATUSES: TurnoverChecklistStatus[] = [
  "open",
  "in_progress",
  "ready",
];

/**
 * The non-terminal states — the unit is still being made rent-ready. `ready` is
 * terminal (the unit can be listed/leased again).
 */
export const OPEN_TURNOVER_STATUSES: TurnoverChecklistStatus[] = [
  "open",
  "in_progress",
];

const LABELS: Record<TurnoverChecklistStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  ready: "Ready",
};

/** Status -> badge tone, from the shared tone source so the pills stay in
 *  lockstep with the rest of the app (same tones the job lifecycle uses). */
const STATUS_TONE: Record<TurnoverChecklistStatus, Tone> = {
  open: "warning",
  in_progress: "progress",
  ready: "success",
};

export function parseTurnoverStatus(
  raw: string | null | undefined,
): TurnoverChecklistStatus | null {
  return raw != null && raw in LABELS
    ? (raw as TurnoverChecklistStatus)
    : null;
}

export function turnoverStatusLabel(s: TurnoverChecklistStatus): string {
  return LABELS[s];
}

/** Tailwind classes for a status badge (theme-safe, light + dark). */
export function turnoverStatusBadgeClass(s: TurnoverChecklistStatus): string {
  return TONE_CLASS[STATUS_TONE[s]];
}

/**
 * True for the non-terminal states {open, in_progress}; false for {ready}. Use
 * this wherever a turnover being "still in progress" matters (the unit being
 * made ready, open-checklist counts) instead of comparing to "ready".
 */
export function isTurnoverOpen(s: TurnoverChecklistStatus): boolean {
  return OPEN_TURNOVER_STATUSES.includes(s);
}

/** Item progress over a checklist's items (done / total). */
export interface TurnoverProgress {
  done: number;
  total: number;
  /** 0..100 (0 when there are no items). */
  percent: number;
}

export function turnoverProgress(
  items: ReadonlyArray<{ done: boolean }>,
): TurnoverProgress {
  const total = items.length;
  const done = items.reduce((n, it) => n + (it.done ? 1 : 0), 0);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

/**
 * Suggested lifecycle status from item progress, used to keep the checklist
 * status honest as items are checked off WITHOUT forcing it (staff can still set
 * the status by hand). Mapping:
 *   - all items done (and at least one item) -> the checklist is `ready`-eligible
 *   - some but not all done                  -> `in_progress`
 *   - none done                              -> `open`
 *
 * The caller decides whether to auto-advance: we never downgrade a manually-set
 * `ready` here — see lib/services/turnover.ts.
 */
export function deriveTurnoverStatus(
  items: ReadonlyArray<{ done: boolean }>,
): TurnoverChecklistStatus {
  const { done, total } = turnoverProgress(items);
  if (total > 0 && done === total) return "ready";
  if (done > 0) return "in_progress";
  return "open";
}

/**
 * Sensible templated default items seeded when a turnover checklist is created.
 * Staff add/remove/edit freely afterwards. Kept here (pure, DB-free) so the
 * template is unit-testable and lives next to the lifecycle it belongs to.
 */
export interface TurnoverItemTemplate {
  label: string;
  area: string;
}

export const DEFAULT_TURNOVER_ITEMS: readonly TurnoverItemTemplate[] = [
  { label: "Inspect unit & document condition", area: "Inspection" },
  { label: "Deep clean throughout", area: "Cleaning" },
  { label: "Clean / service appliances", area: "Kitchen" },
  { label: "Patch and touch-up paint", area: "Paint" },
  { label: "Replace HVAC filter", area: "HVAC" },
  { label: "Test smoke & CO detectors", area: "Safety" },
  { label: "Check plumbing for leaks", area: "Plumbing" },
  { label: "Re-key / change locks", area: "Security" },
] as const;
