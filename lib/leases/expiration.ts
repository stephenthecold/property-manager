import { TONE_CLASS, type Tone } from "@/lib/ui/status-tone";

/**
 * Pure lease-expiration classification (DB-free, clock-injected) — unit-tested.
 *
 * Surfaces leases approaching (or past) their end date so the operator can
 * renew or send notice. Only an `active` lease with a known `endDate` is
 * eligible; everything else (draft, ended, eviction, month_to_month, or no end
 * date) is "none".
 *
 * State, by days remaining until endDate (in the property's clock — callers
 * pass a `now` already aligned to whatever resolution they care about):
 *   expired       → still active but the end date has passed
 *   expiring_soon → ends within 30 days
 *   upcoming      → ends within 60 days
 *   none          → not eligible, or further out than 60 days
 */

export type LeaseStatusLike =
  | "draft"
  | "active"
  | "ended"
  | "eviction"
  | "month_to_month";

export type ExpirationStateName =
  | "expired"
  | "expiring_soon"
  | "upcoming"
  | "none";

export interface ExpirationInput {
  /** Lease end date, or null for an open-ended lease. */
  endDate: Date | null;
  /** Lease lifecycle status; only `active` is eligible. */
  status: LeaseStatusLike;
  now: Date;
}

export interface ExpirationState {
  state: ExpirationStateName;
  /** Whole days from `now` to `endDate` (negative once past); null if ineligible. */
  daysUntilExpiry: number | null;
}

/** Day boundaries for the "soon" / "upcoming" windows. */
export const EXPIRING_SOON_DAYS = 30;
export const UPCOMING_DAYS = 60;

/** Bounds for the operator-configurable alert window (AppSettings.leaseExpirationAlertDays). */
export const MIN_ALERT_DAYS = 1;
export const MAX_ALERT_DAYS = 365;

/**
 * Clamp the stored alert window to a sane range; null/blank/out-of-range falls
 * back to the shipped default (UPCOMING_DAYS = 60). Pure so the AppSettings
 * resolver and every caller (dashboard section + weekly digest) agree on
 * exactly one effective window.
 */
export function sanitizeAlertWindowDays(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return UPCOMING_DAYS;
  const whole = Math.trunc(value);
  if (whole < MIN_ALERT_DAYS) return MIN_ALERT_DAYS;
  if (whole > MAX_ALERT_DAYS) return MAX_ALERT_DAYS;
  return whole;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two instants (ceil so a partial day still counts as a day left). */
function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function expirationState(input: ExpirationInput): ExpirationState {
  // Only active leases with a real end date are eligible.
  if (input.status !== "active" || input.endDate === null) {
    return { state: "none", daysUntilExpiry: null };
  }

  const daysUntilExpiry = daysBetween(input.now, input.endDate);
  // "expired" is decided on the actual instant — the end date has passed —
  // independent of the day rounding. So a lease that ended an hour ago is
  // expired (daysUntilExpiry 0), not merely "expiring_soon, 0 days".
  const isPast = input.endDate.getTime() < input.now.getTime();

  let state: ExpirationStateName;
  if (isPast) state = "expired";
  else if (daysUntilExpiry <= EXPIRING_SOON_DAYS) state = "expiring_soon";
  else if (daysUntilExpiry <= UPCOMING_DAYS) state = "upcoming";
  else state = "none";

  return { state, daysUntilExpiry };
}

/** Short human label for a state (badge text). */
export function expirationLabel(state: ExpirationStateName): string {
  switch (state) {
    case "expired":
      return "Expired";
    case "expiring_soon":
      return "Expiring soon";
    case "upcoming":
      return "Upcoming";
    case "none":
      return "—";
  }
}

/** Eligible states -> badge tone, drawn from the shared tone source. */
const STATE_TONE: Record<Exclude<ExpirationStateName, "none">, Tone> = {
  expired: "danger",
  expiring_soon: "warning",
  upcoming: "info",
};

/**
 * Themed badge classes per state — every colored tint carries its `dark:`
 * variant (UI convention). Returns "" for "none" (no badge).
 */
export function expirationBadgeClass(state: ExpirationStateName): string {
  return state === "none" ? "" : TONE_CLASS[STATE_TONE[state]];
}

/**
 * A days-left chip label, e.g. "in 12 days", "today", "5 days ago".
 * Mirrors the `daysUntilExpiry` sign convention.
 */
export function daysUntilLabel(daysUntilExpiry: number): string {
  if (daysUntilExpiry === 0) return "today";
  if (daysUntilExpiry < 0) {
    const n = Math.abs(daysUntilExpiry);
    return `${n} day${n === 1 ? "" : "s"} ago`;
  }
  return `in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}`;
}
