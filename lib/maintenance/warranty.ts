/**
 * Pure warranty classification for registered assets. Clock-injected (`now`)
 * and DB-free — it decides only how to *display* an asset's warranty relative
 * to today. No money, no ledger, no side effects.
 *
 * warrantyExpiresOn is a date-only value stored at start-of-day (the page
 * renders it with timeZone:"UTC"), so we compare whole UTC days to keep the
 * boundary stable regardless of the server's local zone — mirroring slaState.
 */

export type WarrantyState = "expired" | "expiring_soon" | "active" | "none";

/** A warranty is "expiring soon" when it ends within this many days (inclusive). */
const EXPIRING_SOON_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Start-of-UTC-day epoch ms for a Date. */
function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Classify an asset's warranty standing.
 * - No warranty date -> "none".
 * - Expiry in the past (by whole UTC days) -> "expired".
 * - Expiring within EXPIRING_SOON_DAYS days -> "expiring_soon".
 * - Otherwise -> "active".
 */
export function warrantyState(i: {
  warrantyExpiresOn: Date | null;
  now: Date;
}): WarrantyState {
  if (i.warrantyExpiresOn == null) return "none";
  const daysUntil = Math.round(
    (utcDayStart(i.warrantyExpiresOn) - utcDayStart(i.now)) / MS_PER_DAY,
  );
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
