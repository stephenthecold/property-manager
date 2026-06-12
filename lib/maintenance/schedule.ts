import { DateTime } from "luxon";
import { computeDueDate, periodKeyFor } from "@/lib/accounting/periods";

/**
 * Pure maintenance scheduling math. Clock-injected (`now`) and DB-free, all in
 * the property's IANA timezone, reusing computeDueDate from
 * lib/accounting/periods.ts so a task's "day of month" clamps to short months
 * exactly like a lease due day does (dueDay=31 in February -> Feb 28/29).
 */

/**
 * The next monthly occurrence for a day-of-month schedule, as a "yyyy-MM-dd"
 * ISO date string in the property timezone. Today counts as the occurrence
 * when the clamped due day is today or later this month; otherwise it rolls
 * to next month.
 */
export function nextOccurrenceISO(i: {
  now: Date;
  tz: string;
  /** 1..31, clamped to the last day of short months. */
  dueDay: number;
}): string {
  const today = DateTime.fromJSDate(i.now, { zone: i.tz }).startOf("day");
  let due = computeDueDate(today.year, today.month, i.dueDay, i.tz);
  if (due < today) {
    const next = today.plus({ months: 1 });
    due = computeDueDate(next.year, next.month, i.dueDay, i.tz);
  }
  return periodKeyFor(due);
}

/**
 * True when "today" (in the property tz) falls within
 * [occurrence - daysBefore, occurrence] — i.e. the reminder window is open.
 * The day after the occurrence is false; invalid ISO input is false.
 */
export function notifyWindow(i: {
  now: Date;
  tz: string;
  /** "yyyy-MM-dd" occurrence date in the property timezone. */
  occurrenceISO: string;
  daysBefore: number;
}): boolean {
  const occurrence = DateTime.fromISO(i.occurrenceISO, { zone: i.tz });
  if (!occurrence.isValid) return false;
  const today = DateTime.fromJSDate(i.now, { zone: i.tz }).startOf("day");
  const daysUntil = Math.round(
    occurrence.startOf("day").diff(today, "days").days,
  );
  const window = Math.max(0, Math.trunc(i.daysBefore));
  return daysUntil >= 0 && daysUntil <= window;
}
