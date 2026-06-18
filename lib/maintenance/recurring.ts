import { DateTime } from "luxon";

/**
 * The "YYYY-MM" month key of a moment, evaluated in the property's IANA
 * timezone. This is the period a recurring task is marked done FOR, and the
 * unique key behind a RecurringTaskExecution (one row per task per month).
 *
 * Pure + clock-injected: the same civil-month logic the maintenance page uses
 * for its "done this month" indicator, so the upsert and the badge always agree
 * on which month a completion belongs to (e.g. a late-night completion in a
 * behind-UTC tz stays in the property's civil month, not the UTC one).
 */
export function periodKeyFor(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyy-MM");
}
