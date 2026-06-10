import { DateTime } from "luxon";
import {
  computeDueDate,
  daysBetween,
  graceDeadline,
  periodKeyFor,
} from "@/lib/accounting/periods";

/**
 * Pure scheduling rules for reminders. Clock-injected (`now`) and computed in
 * the property timezone, reusing the exact due-date clamping and grace-deadline
 * semantics of lib/accounting/periods.ts so reminders and late fees never
 * disagree about when a period is due or overdue.
 */

export interface DueSoonCandidate {
  /** "yyyy-MM-dd" of the due date in the property timezone. */
  periodKey: string;
  dueDate: Date;
}

/**
 * The next due date (this month, or next month if this month's has passed),
 * if it falls within `dueSoonDays` whole days of `now` in the property tz.
 */
export function dueSoonCandidate(i: {
  now: Date;
  tz: string;
  dueDay: number;
  dueSoonDays: number;
}): DueSoonCandidate | null {
  const { now, tz, dueDay, dueSoonDays } = i;
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  let due = computeDueDate(today.year, today.month, dueDay, tz);
  if (due < today) {
    const next = today.plus({ months: 1 });
    due = computeDueDate(next.year, next.month, dueDay, tz);
  }
  const windowDays = Math.max(0, Math.trunc(dueSoonDays));
  if (daysBetween(now, due.toJSDate(), tz) > windowDays) return null;
  return { periodKey: periodKeyFor(due), dueDate: due.toJSDate() };
}

/**
 * True strictly after end-of-day(dueDate + gracePeriodDays) in the property tz —
 * identical to the overdue test in lib/accounting/status.ts and the late-fee
 * deadline used by the billing worker.
 */
export function isPastGrace(i: {
  dueDate: Date;
  tz: string;
  gracePeriodDays: number;
  now: Date;
}): boolean {
  return (
    i.now.getTime() >
    graceDeadline(i.dueDate, i.gracePeriodDays, i.tz).getTime()
  );
}
