/**
 * Pure resolution for the per-user dashboard layout (DB-free) — unit-tested.
 *
 * Stored on User.dashboardLayout. Two groups of elements the user can show/hide
 * and reorder: the top STAT BUBBLES and the SECTIONS below them. Reading
 * (resolveLayout) and writing (sanitizeLayout) clamp to the known ids, so
 * adding/removing/renaming an element can never corrupt a saved layout, and a
 * new element appears (visible, at the end) automatically.
 *
 * Back-compat: the previous shape was { order, collapsed } over sections that
 * INCLUDED a "stats" section. We read the legacy `order` into sectionOrder
 * (the now-unknown "stats" id is simply dropped).
 */

export const DASHBOARD_BUBBLE_IDS = [
  "expected_month",
  "collected_month",
  "overdue",
  "collected_today",
  "occupied_units",
  "vacant_units",
  "expenses_month",
  "fixed_costs",
  "net_month",
] as const;

export const DASHBOARD_SECTION_IDS = [
  "vacancy",
  "lease_expirations",
  "tenants",
  "payments",
] as const;

export type DashboardBubbleId = (typeof DASHBOARD_BUBBLE_IDS)[number];
export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export interface DashboardLayout {
  /** Stat bubbles, in display order. */
  bubbleOrder: string[];
  /** Sections, in display order. */
  sectionOrder: string[];
  /** Collapsed sections (id → true). */
  collapsed: Record<string, boolean>;
  /** Hidden elements — bubbles OR sections (id → true). */
  hidden: Record<string, boolean>;
}

export interface DashboardElementIds {
  bubbleIds?: readonly string[];
  sectionIds?: readonly string[];
}

/** Keep saved known ids in saved order (deduped), then append any new known ids. */
function mergeOrder(saved: unknown, knownIds: readonly string[]): string[] {
  const savedOrder = Array.isArray(saved)
    ? saved.filter((x): x is string => typeof x === "string")
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...savedOrder, ...knownIds]) {
    if (knownIds.includes(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Keep only `true` flags for known ids. */
function boolMap(raw: unknown, knownIds: readonly string[]): Record<string, boolean> {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, boolean> = {};
  for (const id of knownIds) if (obj[id] === true) out[id] = true;
  return out;
}

export function resolveLayout(
  saved: unknown,
  ids: DashboardElementIds = {},
): DashboardLayout {
  const bubbleIds = ids.bubbleIds ?? DASHBOARD_BUBBLE_IDS;
  const sectionIds = ids.sectionIds ?? DASHBOARD_SECTION_IDS;
  const s = (saved ?? {}) as {
    bubbleOrder?: unknown;
    sectionOrder?: unknown;
    order?: unknown; // legacy
    collapsed?: unknown;
    hidden?: unknown;
  };

  return {
    bubbleOrder: mergeOrder(s.bubbleOrder, bubbleIds),
    // legacy { order } held the section order (with a now-dropped "stats" id)
    sectionOrder: mergeOrder(s.sectionOrder ?? s.order, sectionIds),
    collapsed: boolMap(s.collapsed, sectionIds),
    hidden: boolMap(s.hidden, [...bubbleIds, ...sectionIds]),
  };
}

/** Same clamp, applied before persisting a client-supplied layout. */
export function sanitizeLayout(
  input: unknown,
  ids: DashboardElementIds = {},
): DashboardLayout {
  return resolveLayout(input, ids);
}
