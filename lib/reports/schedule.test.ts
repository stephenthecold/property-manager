import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  dueReportSchedules,
  isReportCadence,
  isReportScheduleDue,
  reportPeriodForCadence,
  type ReportCadence,
} from "@/lib/reports/schedule";

const TZ = "America/New_York";

/** A New-York-local wall-clock instant (DST-correct via Luxon). */
function nyc(iso: string): Date {
  const dt = DateTime.fromISO(iso, { zone: TZ });
  if (!dt.isValid) throw new Error(`bad test instant: ${iso}`);
  return dt.toJSDate();
}

describe("isReportCadence", () => {
  it("accepts weekly/monthly, rejects others", () => {
    expect(isReportCadence("weekly")).toBe(true);
    expect(isReportCadence("monthly")).toBe(true);
    expect(isReportCadence("daily")).toBe(false);
    expect(isReportCadence("")).toBe(false);
  });
});

describe("isReportScheduleDue — never sent", () => {
  it("is always due when lastSentAt is null/undefined", () => {
    const now = new Date("2026-06-28T13:00:00Z");
    for (const cadence of ["weekly", "monthly"] as ReportCadence[]) {
      expect(isReportScheduleDue({ cadence, lastSentAt: null, tz: TZ }, now)).toBe(true);
      expect(
        isReportScheduleDue({ cadence, lastSentAt: undefined, tz: TZ }, now),
      ).toBe(true);
    }
  });
});

describe("isReportScheduleDue — weekly", () => {
  it("not due again the same ISO week", () => {
    // Both Mon 2026-06-22 and Thu 2026-06-25 are in the same ISO week.
    const last = nyc("2026-06-22T09:00:00");
    const now = nyc("2026-06-25T09:00:00");
    expect(isReportScheduleDue({ cadence: "weekly", lastSentAt: last, tz: TZ }, now)).toBe(
      false,
    );
  });

  it("due once the ISO week rolls over", () => {
    // 2026-06-22 (week A) → 2026-06-29 (next Monday, week B).
    const last = nyc("2026-06-22T09:00:00");
    const now = nyc("2026-06-29T09:00:00");
    expect(isReportScheduleDue({ cadence: "weekly", lastSentAt: last, tz: TZ }, now)).toBe(
      true,
    );
  });

  it("crosses the ISO week-year boundary correctly", () => {
    // Late Dec 2025 and early Jan 2026 can share or differ in ISO week-year;
    // a year apart in the same week number must still be due.
    const last = nyc("2025-06-23T09:00:00");
    const now = nyc("2026-06-22T09:00:00");
    expect(isReportScheduleDue({ cadence: "weekly", lastSentAt: last, tz: TZ }, now)).toBe(
      true,
    );
  });
});

describe("isReportScheduleDue — monthly", () => {
  it("not due again the same calendar month", () => {
    const last = nyc("2026-06-01T09:00:00");
    const now = nyc("2026-06-28T09:00:00");
    expect(isReportScheduleDue({ cadence: "monthly", lastSentAt: last, tz: TZ }, now)).toBe(
      false,
    );
  });

  it("due once the month rolls over", () => {
    const last = nyc("2026-06-28T09:00:00");
    const now = nyc("2026-07-01T09:00:00");
    expect(isReportScheduleDue({ cadence: "monthly", lastSentAt: last, tz: TZ }, now)).toBe(
      true,
    );
  });

  it("due a year later in the same month number", () => {
    const last = nyc("2025-06-15T09:00:00");
    const now = nyc("2026-06-15T09:00:00");
    expect(isReportScheduleDue({ cadence: "monthly", lastSentAt: last, tz: TZ }, now)).toBe(
      true,
    );
  });
});

describe("isReportScheduleDue — timezone sensitivity", () => {
  it("respects the civil-month boundary, not the UTC one", () => {
    // 2026-07-01 00:30 NY time is still 2026-07-01 04:30 UTC — same civil month.
    // Sent 2026-06-30 23:00 NY (June). 'now' an hour later is July in NY.
    const last = nyc("2026-06-30T23:00:00");
    const now = nyc("2026-07-01T00:30:00");
    expect(isReportScheduleDue({ cadence: "monthly", lastSentAt: last, tz: TZ }, now)).toBe(
      true,
    );
  });

  it("falls back gracefully on an invalid tz (treated as due)", () => {
    const last = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-06-02T00:00:00Z");
    // Invalid zone → DateTime invalid → due (so the worker still attempts a send
    // bounded by the post-send lastSentAt stamp), per the documented fallback.
    expect(
      isReportScheduleDue({ cadence: "weekly", lastSentAt: last, tz: "Not/AZone" }, now),
    ).toBe(true);
  });
});

describe("isReportScheduleDue — future lastSentAt (clock skew)", () => {
  it("is not due when lastSentAt is after now", () => {
    const last = nyc("2026-07-01T09:00:00");
    const now = nyc("2026-06-28T09:00:00");
    expect(isReportScheduleDue({ cadence: "weekly", lastSentAt: last, tz: TZ }, now)).toBe(
      false,
    );
    expect(isReportScheduleDue({ cadence: "monthly", lastSentAt: last, tz: TZ }, now)).toBe(
      false,
    );
  });
});

describe("reportPeriodForCadence", () => {
  /** Format a boundary back into the NY wall-clock for readable assertions. */
  const ny = (d: Date) =>
    DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm:ss.SSS");

  it("monthly covers the previous calendar month", () => {
    // now: 2026-07-03 → period = all of June 2026.
    const now = nyc("2026-07-03T07:00:00");
    const { from, to } = reportPeriodForCadence("monthly", now, TZ);
    expect(ny(from)).toBe("2026-06-01 00:00:00.000");
    expect(ny(to)).toBe("2026-06-30 23:59:59.999");
  });

  it("monthly handles the January→December year boundary", () => {
    const now = nyc("2026-01-05T07:00:00");
    const { from, to } = reportPeriodForCadence("monthly", now, TZ);
    expect(ny(from)).toBe("2025-12-01 00:00:00.000");
    expect(ny(to)).toBe("2025-12-31 23:59:59.999");
  });

  it("weekly covers the previous ISO week (Mon..Sun)", () => {
    // 2026-06-29 is a Monday; the previous ISO week is 2026-06-22..06-28.
    const now = nyc("2026-06-29T07:00:00");
    const { from, to } = reportPeriodForCadence("weekly", now, TZ);
    expect(DateTime.fromJSDate(from, { zone: TZ }).weekday).toBe(1); // Monday
    expect(ny(from)).toBe("2026-06-22 00:00:00.000");
    expect(ny(to)).toBe("2026-06-28 23:59:59.999");
  });

  it("from <= to and the range is the completed prior period (before now)", () => {
    const now = nyc("2026-07-15T12:00:00");
    for (const cadence of ["weekly", "monthly"] as ReportCadence[]) {
      const { from, to } = reportPeriodForCadence(cadence, now, TZ);
      expect(from.getTime()).toBeLessThanOrEqual(to.getTime());
      expect(to.getTime()).toBeLessThan(now.getTime());
    }
  });
});

describe("dueReportSchedules", () => {
  it("filters a mixed list to only the due schedules", () => {
    const now = nyc("2026-06-29T09:00:00"); // a fresh ISO week vs 06-22
    const schedules = [
      { id: "never", cadence: "weekly" as const, lastSentAt: null },
      { id: "sameWeek", cadence: "weekly" as const, lastSentAt: nyc("2026-06-29T08:00:00") },
      { id: "lastWeek", cadence: "weekly" as const, lastSentAt: nyc("2026-06-22T09:00:00") },
      { id: "thisMonth", cadence: "monthly" as const, lastSentAt: nyc("2026-06-01T09:00:00") },
    ];
    const due = dueReportSchedules(schedules, TZ, now).map((s) => s.id);
    expect(due).toEqual(["never", "lastWeek"]);
  });
});
