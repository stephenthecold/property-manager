import { DateTime } from "luxon";

/**
 * DB-free scheduling math for ReportSchedule delivery (clock-injected, pure —
 * the worker passes `now` and the stored `lastSentAt`). Mirrors the digest/
 * reminder pure modules so the "is this due?" decision is unit-tested in
 * isolation and the worker sweep stays a thin Prisma ↔ pure-function bridge.
 *
 * A schedule is DUE when it has never been sent, or when the boundary for its
 * cadence has been crossed since the last send, evaluated in the given timezone
 * so "weekly/monthly" line up with civil calendar boundaries (not UTC):
 *   - weekly : the ISO week of `now` differs from the ISO week of `lastSentAt`.
 *   - monthly: the calendar month (year+month) of `now` differs from lastSentAt.
 *
 * Using calendar-boundary comparison (not a rolling 7/30-day window) means a
 * weekly schedule fires at most once per ISO week and a monthly one at most once
 * per month, so a worker that runs daily (and re-runs on restart) can't double-
 * send within a period — the first send stamps lastSentAt into the current
 * period and every later run that period sees "same period → not due".
 */

export type ReportCadence = "weekly" | "monthly";

export function isReportCadence(value: string): value is ReportCadence {
  return value === "weekly" || value === "monthly";
}

export interface DueScheduleInput {
  cadence: ReportCadence;
  /** Last successful send, or null/undefined if never sent. */
  lastSentAt: Date | null | undefined;
  /** IANA timezone the cadence boundary is evaluated in. */
  tz: string;
}

/**
 * Whether the schedule should be delivered at instant `now`. Pure and total:
 * an unknown/invalid tz falls back to UTC so it never throws in the worker.
 */
export function isReportScheduleDue(input: DueScheduleInput, now: Date): boolean {
  if (!input.lastSentAt) return true;

  const zone = input.tz || "utc";
  const nowDt = DateTime.fromJSDate(now, { zone });
  const lastDt = DateTime.fromJSDate(input.lastSentAt, { zone });
  // Defensive: a bad zone yields an invalid DateTime — treat as due rather than
  // silently never firing (the worker's per-send lastSentAt stamp still bounds
  // repeats within the run).
  if (!nowDt.isValid || !lastDt.isValid) return true;

  // A clock skew where lastSentAt is in the future: not due (avoid double-send).
  if (nowDt < lastDt) return false;

  if (input.cadence === "weekly") {
    // Different ISO week OR different ISO-week-year (year boundary).
    return (
      nowDt.weekNumber !== lastDt.weekNumber ||
      nowDt.weekYear !== lastDt.weekYear
    );
  }
  // monthly: different calendar month or year.
  return nowDt.month !== lastDt.month || nowDt.year !== lastDt.year;
}

/** Filter a list of schedules down to those due at `now` (worker convenience). */
export function dueReportSchedules<
  T extends { cadence: ReportCadence; lastSentAt: Date | null },
>(schedules: T[], tz: string, now: Date): T[] {
  return schedules.filter((s) =>
    isReportScheduleDue({ cadence: s.cadence, lastSentAt: s.lastSentAt, tz }, now),
  );
}

/**
 * The reporting period a cadence delivery should COVER, as inclusive instants —
 * for the date-ranged reports (income summary, payments-by-method). The period
 * is the COMPLETED interval immediately before `now`, evaluated in `tz`, so a
 * delivery summarizes the period that just closed rather than a partial current
 * one:
 *   - weekly : the previous ISO week (Mon 00:00 .. Sun 23:59:59.999).
 *   - monthly: the previous calendar month (1st 00:00 .. last day 23:59:59.999).
 *
 * Date-free reports (rent roll, overdue, back rent, lease expirations) ignore
 * this — they are point-in-time snapshots. Pure + clock-injected.
 */
export interface ReportPeriod {
  from: Date;
  to: Date;
}

export function reportPeriodForCadence(
  cadence: ReportCadence,
  now: Date,
  tz: string,
): ReportPeriod {
  const zone = tz || "utc";
  const nowDt = DateTime.fromJSDate(now, { zone });
  const ref = nowDt.isValid ? nowDt : DateTime.fromJSDate(now, { zone: "utc" });
  if (cadence === "weekly") {
    const prev = ref.minus({ weeks: 1 });
    return {
      from: prev.startOf("week").toJSDate(),
      to: prev.endOf("week").toJSDate(),
    };
  }
  const prev = ref.minus({ months: 1 });
  return {
    from: prev.startOf("month").toJSDate(),
    to: prev.endOf("month").toJSDate(),
  };
}
