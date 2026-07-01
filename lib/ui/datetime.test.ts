import { Settings } from "luxon";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateLong, formatDateTime } from "./datetime";

// Pin the Luxon display locale so the hard-coded en-US format assertions below
// are deterministic regardless of the host's ICU default locale (CI hosts vary).
// The helpers use `toLocaleString()` with no explicit locale, so this only
// affects the test, not production behaviour.
Settings.defaultLocale = "en-US";

// A fixed instant: 2026-07-01T02:30:00Z. In UTC this is the 1st at 02:30, but
// in America/New_York (UTC-4 in July) it is still the previous evening —
// 2026-06-30 at 22:30. The bug we're fixing is that a bare toLocaleString()
// renders in the container's UTC; these helpers must honour the passed zone.
const INSTANT = new Date("2026-07-01T02:30:00Z");

describe("formatDateTime", () => {
  it("renders an instant in the given timezone, not UTC", () => {
    const ny = formatDateTime(INSTANT, "America/New_York");
    // 02:30Z → 22:30 the night before in New York.
    expect(ny).toContain("6/30/2026");
    expect(ny).toContain("10:30");

    const utc = formatDateTime(INSTANT, "UTC");
    expect(utc).toContain("7/1/2026");
    expect(utc).toContain("2:30");
  });

  it("falls back to an ISO string for an invalid timezone instead of throwing", () => {
    expect(formatDateTime(INSTANT, "Not/AZone")).toBe(INSTANT.toISOString());
  });
});

describe("formatDate", () => {
  it("renders the calendar date in the given timezone", () => {
    expect(formatDate(INSTANT, "America/New_York")).toBe("6/30/2026");
    expect(formatDate(INSTANT, "UTC")).toBe("7/1/2026");
  });

  it("falls back to the ISO date for an invalid timezone", () => {
    expect(formatDate(INSTANT, "Not/AZone")).toBe("2026-07-01");
  });
});

describe("formatDateLong", () => {
  it("spells out the calendar date in the given timezone", () => {
    expect(formatDateLong(INSTANT, "America/New_York")).toBe("June 30, 2026");
    expect(formatDateLong(INSTANT, "UTC")).toBe("July 1, 2026");
  });

  it("falls back to the ISO date for an invalid timezone", () => {
    expect(formatDateLong(INSTANT, "Not/AZone")).toBe("2026-07-01");
  });
});
