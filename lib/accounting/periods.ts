import { DateTime } from "luxon";

/**
 * Period / due-date math, done entirely in the property's IANA timezone and with
 * an injected `now` so it is deterministic and unit-testable (no `new Date()` here).
 *
 * A period is identified by its due DATE ("YYYY-MM-DD") so the due date is intrinsic
 * to the key and never re-derived inconsistently. `dueDay` is clamped to the last day
 * of short months (e.g. dueDay=31 in February -> 28/29).
 */

export interface PeriodDue {
  /** "YYYY-MM-DD" of the due date in the property timezone. */
  periodKey: string;
  /** The due date as a JS Date (midnight, property tz). */
  dueDate: Date;
}

export function computeDueDate(
  year: number,
  month1to12: number,
  dueDay: number,
  tz: string,
): DateTime {
  const base = DateTime.fromObject(
    { year, month: month1to12, day: 1 },
    { zone: tz },
  );
  const daysInMonth = base.daysInMonth ?? 28;
  const day = Math.min(Math.max(Math.trunc(dueDay), 1), daysInMonth);
  return base.set({ day }).startOf("day");
}

export function periodKeyFor(due: DateTime): string {
  return due.toFormat("yyyy-MM-dd");
}

/**
 * All monthly rent periods whose due date has arrived (<= now), from the first
 * due date on/after the lease start through the lease end (or now). Used by the
 * billing worker to back-fill any missed charges idempotently.
 */
export function listExpectedPeriods(opts: {
  startDate: Date;
  endDate: Date | null;
  dueDay: number;
  tz: string;
  now: Date;
}): PeriodDue[] {
  const { startDate, endDate, dueDay, tz, now } = opts;
  const start = DateTime.fromJSDate(startDate, { zone: tz }).startOf("day");
  const end = endDate
    ? DateTime.fromJSDate(endDate, { zone: tz }).endOf("day")
    : null;
  const nowDt = DateTime.fromJSDate(now, { zone: tz }).endOf("day");

  const result: PeriodDue[] = [];
  let cursor = start.startOf("month");
  let guard = 0;
  while (guard++ < 1200) {
    const due = computeDueDate(cursor.year, cursor.month, dueDay, tz);
    if (due > nowDt) break; // months only increase; nothing further is due yet
    const afterStart = due >= start;
    const withinLease = !end || due <= end;
    if (afterStart && withinLease) {
      result.push({ periodKey: periodKeyFor(due), dueDate: due.toJSDate() });
    }
    cursor = cursor.plus({ months: 1 });
    if (end && cursor.startOf("month") > end) break;
  }
  return result;
}

/** Whole days `b - a` (positive if b is after a), measured in the property tz. */
export function daysBetween(a: Date, b: Date, tz: string): number {
  const da = DateTime.fromJSDate(a, { zone: tz }).startOf("day");
  const db = DateTime.fromJSDate(b, { zone: tz }).startOf("day");
  return Math.round(db.diff(da, "days").days);
}

/** A due date plus `graceDays`, in the property tz (the moment overdue begins). */
export function graceDeadline(dueDate: Date, graceDays: number, tz: string): Date {
  return DateTime.fromJSDate(dueDate, { zone: tz })
    .startOf("day")
    .plus({ days: Math.max(0, Math.trunc(graceDays)) })
    .endOf("day")
    .toJSDate();
}
