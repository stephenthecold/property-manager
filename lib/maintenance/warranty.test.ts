import { describe, it, expect } from "vitest";
import {
  warrantyState,
  warrantyLabel,
  warrantyBadgeClass,
  type WarrantyState,
} from "@/lib/maintenance/warranty";

// All comparisons are whole-UTC-day based, so build date-only values at UTC
// midnight just like the persisted warrantyExpiresOn.
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const now = utc("2026-06-18");

describe("warrantyState", () => {
  it("returns 'none' when there is no warranty date", () => {
    expect(warrantyState({ warrantyExpiresOn: null, now })).toBe("none");
  });

  it("flags a past expiry as expired", () => {
    expect(warrantyState({ warrantyExpiresOn: utc("2026-06-17"), now })).toBe(
      "expired",
    );
  });

  it("treats today (0 days out) as expiring_soon", () => {
    expect(warrantyState({ warrantyExpiresOn: utc("2026-06-18"), now })).toBe(
      "expiring_soon",
    );
  });

  it("is expiring_soon exactly at the 30-day boundary", () => {
    expect(warrantyState({ warrantyExpiresOn: utc("2026-07-18"), now })).toBe(
      "expiring_soon",
    );
  });

  it("is active one day past the 30-day boundary", () => {
    expect(warrantyState({ warrantyExpiresOn: utc("2026-07-19"), now })).toBe(
      "active",
    );
  });

  it("is active for a far-future expiry", () => {
    expect(warrantyState({ warrantyExpiresOn: utc("2030-01-01"), now })).toBe(
      "active",
    );
  });
});

describe("warranty display helpers", () => {
  const states: WarrantyState[] = ["expired", "expiring_soon", "active", "none"];

  it("has a label for every state", () => {
    for (const s of states) expect(warrantyLabel(s)).toBeTruthy();
  });

  it("gives every colored tint a dark: variant (theme-safe)", () => {
    for (const s of states) {
      const cls = warrantyBadgeClass(s);
      // Non-muted tints must ship dark: variants; the muted one uses tokens.
      if (cls.includes("bg-") && !cls.includes("bg-muted")) {
        expect(cls).toContain("dark:");
      }
    }
  });
});
