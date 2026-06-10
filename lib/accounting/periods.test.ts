import { describe, it, expect } from "vitest";
import {
  computeDueDate,
  daysBetween,
  graceDeadline,
  listExpectedPeriods,
  periodKeyFor,
} from "@/lib/accounting/periods";

const TZ = "America/New_York";

describe("computeDueDate / short months", () => {
  it("clamps dueDay=31 to end of February", () => {
    expect(periodKeyFor(computeDueDate(2026, 2, 31, TZ))).toBe("2026-02-28");
    expect(periodKeyFor(computeDueDate(2024, 2, 31, TZ))).toBe("2024-02-29"); // leap
  });
  it("keeps a normal due day", () => {
    expect(periodKeyFor(computeDueDate(2026, 6, 15, TZ))).toBe("2026-06-15");
  });
});

describe("listExpectedPeriods", () => {
  it("lists each monthly due date up to now", () => {
    const periods = listExpectedPeriods({
      startDate: new Date("2026-01-01T00:00:00-05:00"),
      endDate: null,
      dueDay: 1,
      tz: TZ,
      now: new Date("2026-03-15T12:00:00-04:00"),
    });
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  it("handles short-month due days across the year", () => {
    const periods = listExpectedPeriods({
      startDate: new Date("2026-01-31T00:00:00-05:00"),
      endDate: null,
      dueDay: 31,
      tz: TZ,
      now: new Date("2026-03-31T23:00:00-04:00"),
    });
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("does not generate a period whose due date hasn't arrived in the property tz (UTC day gap)", () => {
    // 2026-03-01T02:00Z is 2026-02-28 21:00 in New York -> March is NOT yet due.
    const periods = listExpectedPeriods({
      startDate: new Date("2026-01-01T00:00:00-05:00"),
      endDate: null,
      dueDay: 1,
      tz: TZ,
      now: new Date("2026-03-01T02:00:00Z"),
    });
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("stops at lease end", () => {
    const periods = listExpectedPeriods({
      startDate: new Date("2026-01-01T00:00:00-05:00"),
      endDate: new Date("2026-02-15T00:00:00-05:00"),
      dueDay: 1,
      tz: TZ,
      now: new Date("2026-06-01T00:00:00-04:00"),
    });
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("skips a first due date before the lease start", () => {
    // start Jan 15, dueDay 1 -> Jan 1 is before start, so first charge is Feb 1.
    const periods = listExpectedPeriods({
      startDate: new Date("2026-01-15T00:00:00-05:00"),
      endDate: null,
      dueDay: 1,
      tz: TZ,
      now: new Date("2026-02-10T00:00:00-05:00"),
    });
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-02-01"]);
  });

  it("is correct across a DST spring-forward boundary", () => {
    // US DST 2026-03-08. dueDay 8 should still key to the 8th each month.
    const periods = listExpectedPeriods({
      startDate: new Date("2026-02-08T00:00:00-05:00"),
      endDate: null,
      dueDay: 8,
      tz: TZ,
      now: new Date("2026-03-09T00:00:00-04:00"),
    });
    expect(periods.map((p) => p.periodKey)).toEqual([
      "2026-02-08",
      "2026-03-08",
    ]);
  });
});

describe("daysBetween / graceDeadline", () => {
  it("counts whole days in the property tz", () => {
    expect(
      daysBetween(
        new Date("2026-06-01T00:00:00-04:00"),
        new Date("2026-06-06T12:00:00-04:00"),
        TZ,
      ),
    ).toBe(5);
  });
  it("grace deadline is end of due+grace day", () => {
    const deadline = graceDeadline(
      new Date("2026-06-01T00:00:00-04:00"),
      5,
      TZ,
    );
    // 5 days after Jun 1 is Jun 6; deadline is end of Jun 6.
    expect(deadline.getTime()).toBeGreaterThan(
      new Date("2026-06-06T12:00:00-04:00").getTime(),
    );
    expect(deadline.getTime()).toBeLessThan(
      new Date("2026-06-07T00:00:01-04:00").getTime(),
    );
  });
});
