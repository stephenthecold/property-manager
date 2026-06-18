import { describe, expect, it } from "vitest";
import {
  expirationState,
  expirationLabel,
  expirationBadgeClass,
  daysUntilLabel,
  type ExpirationInput,
  type LeaseStatusLike,
} from "./expiration";

const now = new Date("2026-06-15T00:00:00Z");

/** endDate `days` whole days from `now`. */
function inDays(days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function e(partial: Partial<ExpirationInput>): ExpirationInput {
  return { endDate: null, status: "active", now, ...partial };
}

describe("expirationState", () => {
  it("active lease ending well out (> 60 days) → none, with day count", () => {
    expect(expirationState(e({ endDate: inDays(90) }))).toEqual({
      state: "none",
      daysUntilExpiry: 90,
    });
  });

  it("ends within 30 days → expiring_soon", () => {
    expect(expirationState(e({ endDate: inDays(10) }))).toEqual({
      state: "expiring_soon",
      daysUntilExpiry: 10,
    });
  });

  it("ends within 60 days (but > 30) → upcoming", () => {
    expect(expirationState(e({ endDate: inDays(45) }))).toEqual({
      state: "upcoming",
      daysUntilExpiry: 45,
    });
  });

  it("past end but still active → expired (negative days)", () => {
    expect(expirationState(e({ endDate: inDays(-5) }))).toEqual({
      state: "expired",
      daysUntilExpiry: -5,
    });
  });

  // --- boundaries -----------------------------------------------------------

  it("exactly 30 days → expiring_soon (inclusive)", () => {
    expect(expirationState(e({ endDate: inDays(30) })).state).toBe("expiring_soon");
  });

  it("just over 30 days → upcoming", () => {
    const justOver = new Date(inDays(30).getTime() + 1000); // 30 days + 1s ⇒ ceil = 31
    expect(expirationState(e({ endDate: justOver })).state).toBe("upcoming");
  });

  it("exactly 60 days → upcoming (inclusive)", () => {
    expect(expirationState(e({ endDate: inDays(60) })).state).toBe("upcoming");
  });

  it("just over 60 days → none", () => {
    const justOver = new Date(inDays(60).getTime() + 1000); // ceil = 61
    expect(expirationState(e({ endDate: justOver })).state).toBe("none");
  });

  it("ends today / right now → expiring_soon (0 days, not yet expired)", () => {
    expect(expirationState(e({ endDate: now }))).toEqual({
      state: "expiring_soon",
      daysUntilExpiry: 0,
    });
  });

  it("a moment past end → expired", () => {
    const justPast = new Date(now.getTime() - 1000);
    expect(expirationState(e({ endDate: justPast })).state).toBe("expired");
  });

  // --- ineligibility --------------------------------------------------------

  it("active lease with null endDate → none, null days", () => {
    expect(expirationState(e({ endDate: null }))).toEqual({
      state: "none",
      daysUntilExpiry: null,
    });
  });

  it.each<LeaseStatusLike>(["draft", "ended", "eviction", "month_to_month"])(
    "%s status (even within window) → none, null days",
    (status) => {
      expect(expirationState(e({ status, endDate: inDays(5) }))).toEqual({
        state: "none",
        daysUntilExpiry: null,
      });
    },
  );
});

describe("display helpers", () => {
  it("labels each state", () => {
    expect(expirationLabel("expired")).toBe("Expired");
    expect(expirationLabel("expiring_soon")).toBe("Expiring soon");
    expect(expirationLabel("upcoming")).toBe("Upcoming");
    expect(expirationLabel("none")).toBe("—");
  });

  it("every colored badge tint carries a dark: variant; none is empty", () => {
    for (const s of ["expired", "expiring_soon", "upcoming"] as const) {
      expect(expirationBadgeClass(s)).toContain("dark:");
    }
    expect(expirationBadgeClass("none")).toBe("");
  });

  it("days-left chip reads naturally on both sides of zero", () => {
    expect(daysUntilLabel(12)).toBe("in 12 days");
    expect(daysUntilLabel(1)).toBe("in 1 day");
    expect(daysUntilLabel(0)).toBe("today");
    expect(daysUntilLabel(-1)).toBe("1 day ago");
    expect(daysUntilLabel(-5)).toBe("5 days ago");
  });
});
