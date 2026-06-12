import { describe, it, expect } from "vitest";
import { nextOccurrenceISO, notifyWindow } from "@/lib/maintenance/schedule";

const TZ = "America/New_York";

/** Noon Eastern on the given civil date — unambiguous across DST. */
function easternNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00-04:00`);
}

describe("nextOccurrenceISO", () => {
  it("returns this month's occurrence when the due day is still ahead", () => {
    expect(
      nextOccurrenceISO({ now: easternNoon("2026-06-10"), tz: TZ, dueDay: 15 }),
    ).toBe("2026-06-15");
  });

  it("counts today as the occurrence (not yet passed)", () => {
    expect(
      nextOccurrenceISO({ now: easternNoon("2026-06-15"), tz: TZ, dueDay: 15 }),
    ).toBe("2026-06-15");
  });

  it("rolls to next month when this month's day has passed", () => {
    expect(
      nextOccurrenceISO({ now: easternNoon("2026-06-16"), tz: TZ, dueDay: 15 }),
    ).toBe("2026-07-15");
  });

  it("clamps dueDay=31 to the end of February", () => {
    expect(
      nextOccurrenceISO({
        now: new Date("2026-02-10T12:00:00-05:00"),
        tz: TZ,
        dueDay: 31,
      }),
    ).toBe("2026-02-28");
    // Leap year clamps to the 29th.
    expect(
      nextOccurrenceISO({
        now: new Date("2024-02-10T12:00:00-05:00"),
        tz: TZ,
        dueDay: 31,
      }),
    ).toBe("2024-02-29");
  });

  it("rolls past a clamped occurrence into the next month unclamped", () => {
    // Feb 28 (clamped 31st) has passed -> next is March 31.
    expect(
      nextOccurrenceISO({
        now: new Date("2026-03-01T12:00:00-05:00"),
        tz: TZ,
        dueDay: 31,
      }),
    ).toBe("2026-03-31");
  });

  it("uses the property timezone's civil date, not the UTC date", () => {
    // 2026-06-13T03:00Z is still June 12, 8pm in Los_Angeles: the 12th has
    // not passed there, so the occurrence is today — while a UTC reading
    // would already have rolled to July 12.
    const now = new Date("2026-06-13T03:00:00Z");
    expect(
      nextOccurrenceISO({ now, tz: "America/Los_Angeles", dueDay: 12 }),
    ).toBe("2026-06-12");
    expect(nextOccurrenceISO({ now, tz: "UTC", dueDay: 12 })).toBe(
      "2026-07-12",
    );
  });
});

describe("notifyWindow", () => {
  const occurrenceISO = "2026-06-15";

  it("opens exactly daysBefore days ahead", () => {
    expect(
      notifyWindow({
        now: easternNoon("2026-06-13"),
        tz: TZ,
        occurrenceISO,
        daysBefore: 2,
      }),
    ).toBe(true);
  });

  it("is closed the day before the window opens", () => {
    expect(
      notifyWindow({
        now: easternNoon("2026-06-12"),
        tz: TZ,
        occurrenceISO,
        daysBefore: 2,
      }),
    ).toBe(false);
  });

  it("stays open through the occurrence day itself", () => {
    expect(
      notifyWindow({
        now: easternNoon("2026-06-15"),
        tz: TZ,
        occurrenceISO,
        daysBefore: 2,
      }),
    ).toBe(true);
  });

  it("closes the day after the occurrence", () => {
    expect(
      notifyWindow({
        now: easternNoon("2026-06-16"),
        tz: TZ,
        occurrenceISO,
        daysBefore: 2,
      }),
    ).toBe(false);
  });

  it("daysBefore=0 fires only on the day itself", () => {
    expect(
      notifyWindow({
        now: easternNoon("2026-06-14"),
        tz: TZ,
        occurrenceISO,
        daysBefore: 0,
      }),
    ).toBe(false);
    expect(
      notifyWindow({
        now: easternNoon("2026-06-15"),
        tz: TZ,
        occurrenceISO,
        daysBefore: 0,
      }),
    ).toBe(true);
  });

  it("evaluates 'today' in the property timezone, not UTC", () => {
    // June 13, 3am UTC = June 12, 8pm in Los_Angeles. With daysBefore=0 the
    // window for the 12th is open in LA but already closed for a UTC clock.
    const now = new Date("2026-06-13T03:00:00Z");
    expect(
      notifyWindow({
        now,
        tz: "America/Los_Angeles",
        occurrenceISO: "2026-06-12",
        daysBefore: 0,
      }),
    ).toBe(true);
    expect(
      notifyWindow({ now, tz: "UTC", occurrenceISO: "2026-06-12", daysBefore: 0 }),
    ).toBe(false);
  });

  it("returns false for an invalid occurrence string", () => {
    expect(
      notifyWindow({
        now: easternNoon("2026-06-15"),
        tz: TZ,
        occurrenceISO: "not-a-date",
        daysBefore: 2,
      }),
    ).toBe(false);
  });
});
