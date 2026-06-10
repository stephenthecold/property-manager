import { describe, it, expect } from "vitest";
import { dueSoonCandidate, isPastGrace } from "@/lib/reminders/rules";

const TZ = "America/New_York";

describe("dueSoonCandidate / window edges", () => {
  it("due in exactly dueSoonDays days is a candidate", () => {
    const c = dueSoonCandidate({
      now: new Date("2026-05-29T12:00:00-04:00"),
      tz: TZ,
      dueDay: 1,
      dueSoonDays: 3,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2026-06-01");
  });

  it("due today is a candidate even late in the day", () => {
    const c = dueSoonCandidate({
      now: new Date("2026-06-01T22:30:00-04:00"),
      tz: TZ,
      dueDay: 1,
      dueSoonDays: 3,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2026-06-01");
  });

  it("due today is a candidate with dueSoonDays=0", () => {
    const c = dueSoonCandidate({
      now: new Date("2026-06-01T08:00:00-04:00"),
      tz: TZ,
      dueDay: 1,
      dueSoonDays: 0,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2026-06-01");
  });

  it("due tomorrow with dueSoonDays=0 is null", () => {
    const c = dueSoonCandidate({
      now: new Date("2026-05-31T12:00:00-04:00"),
      tz: TZ,
      dueDay: 1,
      dueSoonDays: 0,
    });
    expect(c).toBeNull();
  });

  it("due one day beyond the window is null", () => {
    const c = dueSoonCandidate({
      now: new Date("2026-05-28T12:00:00-04:00"),
      tz: TZ,
      dueDay: 1,
      dueSoonDays: 3,
    });
    expect(c).toBeNull();
  });

  it("rolls to next month when this month's due date has passed", () => {
    // Jun 15 already passed; next due is Jul 15, 29 days out.
    const c = dueSoonCandidate({
      now: new Date("2026-06-16T09:00:00-04:00"),
      tz: TZ,
      dueDay: 15,
      dueSoonDays: 30,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2026-07-15");
  });
});

describe("dueSoonCandidate / month-end clamping", () => {
  it("clamps dueDay=31 to Feb 28 in a non-leap year", () => {
    const c = dueSoonCandidate({
      now: new Date("2026-02-26T12:00:00-05:00"),
      tz: TZ,
      dueDay: 31,
      dueSoonDays: 3,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2026-02-28");
  });

  it("clamps dueDay=31 to Feb 29 in a leap year", () => {
    const c = dueSoonCandidate({
      now: new Date("2024-02-27T12:00:00-05:00"),
      tz: TZ,
      dueDay: 31,
      dueSoonDays: 3,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2024-02-29");
  });
});

describe("dueSoonCandidate / timezone boundaries", () => {
  // Same UTC instant, different property tz -> different answer.
  const instant = new Date("2026-03-01T02:00:00Z");

  it("is Feb 28 in New York, so Mar 1 is one day away", () => {
    const c = dueSoonCandidate({
      now: instant,
      tz: TZ,
      dueDay: 1,
      dueSoonDays: 1,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2026-03-01");

    expect(
      dueSoonCandidate({ now: instant, tz: TZ, dueDay: 1, dueSoonDays: 0 }),
    ).toBeNull();
  });

  it("is already Mar 1 in UTC, so the same instant is due today there", () => {
    const c = dueSoonCandidate({
      now: instant,
      tz: "UTC",
      dueDay: 1,
      dueSoonDays: 0,
    });
    expect(c).not.toBeNull();
    expect(c!.periodKey).toBe("2026-03-01");
  });
});

describe("isPastGrace", () => {
  const dueDate = new Date("2026-06-01T00:00:00-04:00");
  // grace 5 days -> deadline is end of Jun 6 in New York (23:59:59.999-04:00).

  it("is false exactly at the grace deadline", () => {
    expect(
      isPastGrace({
        dueDate,
        tz: TZ,
        gracePeriodDays: 5,
        now: new Date("2026-06-06T23:59:59.999-04:00"),
      }),
    ).toBe(false);
  });

  it("is true 1ms after the grace deadline", () => {
    expect(
      isPastGrace({
        dueDate,
        tz: TZ,
        gracePeriodDays: 5,
        now: new Date("2026-06-07T00:00:00.000-04:00"),
      }),
    ).toBe(true);
  });

  it("with zero grace, becomes true only after the due day ends", () => {
    expect(
      isPastGrace({
        dueDate,
        tz: TZ,
        gracePeriodDays: 0,
        now: new Date("2026-06-01T23:59:59.999-04:00"),
      }),
    ).toBe(false);
    expect(
      isPastGrace({
        dueDate,
        tz: TZ,
        gracePeriodDays: 0,
        now: new Date("2026-06-02T00:00:00.000-04:00"),
      }),
    ).toBe(true);
  });
});
