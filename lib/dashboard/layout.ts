/**
 * Pure resolution for the per-user dashboard layout (DB-free) — unit-tested.
 *
 * Stored on User.dashboardLayout as { order: string[], collapsed: {id:true} }.
 * Both reading (resolveLayout) and writing (sanitizeLayout) clamp to the known
 * section ids, so renaming/removing a section can never corrupt a saved layout
 * and a newly-added section appears (expanded, at the end) automatically.
 */

export const DASHBOARD_SECTION_IDS = [
  "stats",
  "vacancy",
  "tenants",
  "payments",
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export interface DashboardLayout {
  /** Every known section id, in display order. */
  order: string[];
  /** Collapsed sections (id → true). Absent id = expanded. */
  collapsed: Record<string, boolean>;
}

/**
 * Merge a stored (untrusted) layout with the known section ids: keep saved
 * known ids in their saved order (deduped), then append any known ids the saved
 * order didn't include; keep only `true` collapsed flags for known ids.
 */
export function resolveLayout(
  saved: unknown,
  knownIds: readonly string[] = DASHBOARD_SECTION_IDS,
): DashboardLayout {
  const s = (saved ?? {}) as { order?: unknown; collapsed?: unknown };
  const savedOrder = Array.isArray(s.order)
    ? s.order.filter((x): x is string => typeof x === "string")
    : [];

  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of [...savedOrder, ...knownIds]) {
    if (knownIds.includes(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }

  const collapsedRaw =
    s.collapsed && typeof s.collapsed === "object"
      ? (s.collapsed as Record<string, unknown>)
      : {};
  const collapsed: Record<string, boolean> = {};
  for (const id of knownIds) {
    if (collapsedRaw[id] === true) collapsed[id] = true;
  }

  return { order, collapsed };
}

/** Same clamp, applied before persisting a client-supplied layout. */
export function sanitizeLayout(
  input: unknown,
  knownIds: readonly string[] = DASHBOARD_SECTION_IDS,
): DashboardLayout {
  return resolveLayout(input, knownIds);
}
