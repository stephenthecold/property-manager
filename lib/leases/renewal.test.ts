import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  computeRenewalTerms,
  isRenewalModel,
  isRenewalOpen,
  RENEWAL_MODELS,
  suggestRenewalRentCents,
  validateRenewalOffer,
} from "@/lib/leases/renewal";

const TZ = "America/New_York";
// A lease ending 2026-12-31 (local midnight in TZ).
const end2026 = DateAt("2026-12-31", TZ);

function DateAt(isoDate: string, tz: string): Date {
  // Local-midnight of isoDate in tz — how the app stores date-only lease fields.
  return DateTime.fromISO(isoDate, { zone: tz }).startOf("day").toJSDate();
}

describe("computeRenewalTerms", () => {
  it("starts the new term the day after the current end and runs N months", () => {
    const { effectiveDate, newEndDate } = computeRenewalTerms({
      currentEndDate: end2026,
      termMonths: 12,
      tz: TZ,
    });
    // Effective = 2027-01-01, new end = 2027-12-31 (in TZ).
    const eff = effectiveDate.toLocaleDateString("en-CA", { timeZone: TZ });
    const ne = newEndDate.toLocaleDateString("en-CA", { timeZone: TZ });
    expect(eff).toBe("2027-01-01");
    expect(ne).toBe("2027-12-31");
  });

  it("handles a 6-month term", () => {
    const { newEndDate } = computeRenewalTerms({
      currentEndDate: end2026,
      termMonths: 6,
      tz: TZ,
    });
    expect(newEndDate.toLocaleDateString("en-CA", { timeZone: TZ })).toBe("2027-06-30");
  });
});

describe("suggestRenewalRentCents", () => {
  it("bumps by basis points, rounded half-up", () => {
    expect(suggestRenewalRentCents(100000n, 300)).toBe(103000n); // +3%
    expect(suggestRenewalRentCents(123456n, 250)).toBe(126542n); // +2.5%: 3086.4 -> 3086
  });
  it("keeps rent flat at 0 bps", () => {
    expect(suggestRenewalRentCents(150000n, 0)).toBe(150000n);
  });
  it("allows a reduction and clamps at zero", () => {
    expect(suggestRenewalRentCents(100000n, -500)).toBe(95000n);
    expect(suggestRenewalRentCents(100n, -100000)).toBe(0n);
  });
});

describe("validateRenewalOffer", () => {
  const proposedEnd = DateAt("2027-12-31", TZ);
  it("accepts well-formed terms", () => {
    expect(
      validateRenewalOffer({ currentEndDate: end2026, proposedEndDate: proposedEnd, proposedRentCents: 103000n }),
    ).toEqual({ ok: true });
  });
  it("rejects a lease with no end date", () => {
    const r = validateRenewalOffer({ currentEndDate: null, proposedEndDate: proposedEnd, proposedRentCents: 1000n });
    expect(r.ok).toBe(false);
  });
  it("rejects negative rent", () => {
    const r = validateRenewalOffer({ currentEndDate: end2026, proposedEndDate: proposedEnd, proposedRentCents: -1n });
    expect(r.ok).toBe(false);
  });
  it("rejects an end that is not after the current end", () => {
    const r = validateRenewalOffer({ currentEndDate: end2026, proposedEndDate: end2026, proposedRentCents: 1000n });
    expect(r.ok).toBe(false);
  });
});

describe("model + status guards", () => {
  it("recognizes valid models", () => {
    expect(isRenewalModel("extend")).toBe(true);
    expect(isRenewalModel("successor")).toBe(true);
    expect(isRenewalModel("bogus")).toBe(false);
    expect(RENEWAL_MODELS).toHaveLength(2);
  });
  it("treats draft/sent as open, terminal states as closed", () => {
    expect(isRenewalOpen("draft")).toBe(true);
    expect(isRenewalOpen("sent")).toBe(true);
    expect(isRenewalOpen("accepted")).toBe(false);
    expect(isRenewalOpen("declined")).toBe(false);
    expect(isRenewalOpen("canceled")).toBe(false);
  });
});
