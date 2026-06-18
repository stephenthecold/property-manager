import { daysBetween } from "@/lib/accounting/periods";

/**
 * Pure warranty classification for registered assets. Clock-injected (`now`)
 * and DB-free — it decides only how to *display* an asset's warranty relative
 * to today. No money, no ledger, no side effects.
 *
 * warrantyExpiresOn is a date-only value persisted at start-of-day in the
 * PROPERTY timezone (via parseDateOnlyInZone), so the day math runs in that
 * same zone — reusing daysBetween (lib/accounting/periods.ts). `tz` defaults
 * to UTC, which is correct when the stored instant is UTC midnight.
 */

export type WarrantyState = "expired" | "expiring_soon" | "active" | "none";

/** A warranty is "expiring soon" when it ends within this many days (inclusive). */
const EXPIRING_SOON_DAYS = 30;

/**
 * Classify an asset's warranty standing.
 * - No warranty date -> "none".
 * - Expiry in the past (by whole days in `tz`) -> "expired".
 * - Expiring within EXPIRING_SOON_DAYS days -> "expiring_soon".
 * - Otherwise -> "active".
 */
export function warrantyState(i: {
  warrantyExpiresOn: Date | null;
  now: Date;
  tz?: string;
}): WarrantyState {
  if (i.warrantyExpiresOn == null) return "none";
  const tz = i.tz ?? "UTC";
  const daysUntil = daysBetween(i.now, i.warrantyExpiresOn, tz);
  if (daysUntil < 0) return "expired";
  if (daysUntil <= EXPIRING_SOON_DAYS) return "expiring_soon";
  return "active";
}

const LABELS: Record<WarrantyState, string> = {
  expired: "Expired",
  expiring_soon: "Expiring soon",
  active: "Active",
  none: "No warranty",
};

/** Themed badge tints per warranty state (every tint carries a dark: variant). */
const BADGE: Record<WarrantyState, string> = {
  expired:
    "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  expiring_soon:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  active:
    "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  none: "border-muted bg-muted text-muted-foreground",
};

export function warrantyLabel(s: WarrantyState): string {
  return LABELS[s];
}

/** Tailwind classes for a warranty badge (theme-safe). */
export function warrantyBadgeClass(s: WarrantyState): string {
  return BADGE[s];
}
