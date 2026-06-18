import { DateTime } from "luxon";

/**
 * The "YYYY-MM" month key of a moment, evaluated in the property's IANA
 * timezone. This is the period a recurring task is marked done FOR, and the
 * unique key behind a RecurringTaskExecution (one row per task per month).
 *
 * Named distinctly from lib/accounting/periods.ts `periodKeyFor` (which keys a
 * DATE as "yyyy-MM-dd" from a DateTime) — this keys a MONTH from a Date + tz.
 *
 * Pure + clock-injected: a late-night completion in a behind-UTC tz stays in
 * the property's civil month, not the UTC one (mirrors the "done this month"
 * indicator's civil-month comparison on the maintenance page).
 */
export function monthKeyFor(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyy-MM");
}
