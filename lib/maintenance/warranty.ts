import { daysBetween } from "@/lib/accounting/periods";
import { TONE_CLASS, type Tone } from "@/lib/ui/status-tone";

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

/** Warranty state -> badge tone, drawn from the shared tone source. */
const STATE_TONE: Record<WarrantyState, Tone> = {
  expired: "danger",
  expiring_soon: "warning",
  active: "success",
  none: "neutral",
};

export function warrantyLabel(s: WarrantyState): string {
  return LABELS[s];
}

/** Tailwind classes for a warranty badge (theme-safe). */
export function warrantyBadgeClass(s: WarrantyState): string {
  return TONE_CLASS[STATE_TONE[s]];
}
