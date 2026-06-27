import { DateTime } from "luxon";

/**
 * Tz-aware DISPLAY date formatting — the one place property-timezone display
 * dates are built, replacing the `DateTime.fromJSDate(d,{zone}).setLocale("en-US")
 * .toLocaleString(...)` shape that was copy-pasted across services and pages.
 *
 * Display only — period/billing math stays in lib/accounting (clock-injected,
 * DB-free). Pure + clock-free, so easily unit-tested.
 */

/** A date in the given IANA timezone, long form: "June 27, 2026" (Luxon DATE_FULL). */
export function formatDateInTz(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz })
    .setLocale("en-US")
    .toLocaleString(DateTime.DATE_FULL);
}
