import { describe, it, expect } from "vitest";
import { monthKeyFor } from "@/lib/maintenance/recurring";

describe("monthKeyFor", () => {
  it("returns the YYYY-MM of the property-timezone civil month", () => {
    expect(monthKeyFor(new Date("2026-06-15T12:00:00-04:00"), "America/New_York")).toBe(
      "2026-06",
    );
  });

  it("uses the property timezone's civil month, not the UTC month", () => {
    // 2026-07-01T03:00Z is still June 30, 8pm in Los_Angeles: the completion
    // belongs to June there, while a UTC reading would already be July.
    const instant = new Date("2026-07-01T03:00:00Z");
    expect(monthKeyFor(instant, "America/Los_Angeles")).toBe("2026-06");
    expect(monthKeyFor(instant, "UTC")).toBe("2026-07");
  });

  it("rolls the month forward at the local boundary in an ahead-of-UTC tz", () => {
    // 2026-05-31T20:00Z is June 1, 6am in Sydney (UTC+10).
    const instant = new Date("2026-05-31T20:00:00Z");
    expect(monthKeyFor(instant, "Australia/Sydney")).toBe("2026-06");
    expect(monthKeyFor(instant, "UTC")).toBe("2026-05");
  });

  it("zero-pads single-digit months", () => {
    expect(monthKeyFor(new Date("2026-01-09T12:00:00Z"), "UTC")).toBe("2026-01");
  });
});
