import { DateTime } from "luxon";

/**
 * Display an INSTANT (a stored UTC timestamp — createdAt, receivedAt, sentAt,
 * lastLoginAt, …) in a chosen IANA timezone. Server components render in the
 * container's timezone (UTC) by default, so a bare `date.toLocaleString()` shows
 * UTC — which reads as hours in the future for a behind-UTC (US) viewer. Pass the
 * org's timezone (AppSettings.defaultTimezone) here instead.
 *
 * Defensive: the org timezone is free-text, and `Intl.toLocaleString` THROWS on a
 * bad zone — Luxon returns an invalid DateTime, which we detect and fall back to
 * an ISO string rather than crashing the page. For date-ONLY civil values (due
 * dates, effective dates) keep pinning the appropriate zone at the call site;
 * these helpers are for instants.
 */

export function formatDateTime(date: Date, tz: string): string {
  const dt = DateTime.fromJSDate(date, { zone: tz });
  return dt.isValid
    ? dt.toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS)
    : date.toISOString();
}

/** Instant → just its calendar date in `tz` (e.g. a "Created" column showing the day). */
export function formatDate(date: Date, tz: string): string {
  const dt = DateTime.fromJSDate(date, { zone: tz });
  return dt.isValid ? dt.toLocaleString(DateTime.DATE_SHORT) : date.toISOString().slice(0, 10);
}

/** Instant → its calendar date in `tz`, spelled out ("July 1, 2026") for detail headers. */
export function formatDateLong(date: Date, tz: string): string {
  const dt = DateTime.fromJSDate(date, { zone: tz });
  return dt.isValid ? dt.toLocaleString(DateTime.DATE_FULL) : date.toISOString().slice(0, 10);
}
