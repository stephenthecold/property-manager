import { describe, it, expect } from "vitest";
import { billingRunIsStale, BILLING_STALE_HOURS } from "./billing-health";

const NOW = new Date("2026-07-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("billingRunIsStale", () => {
  it("is stale when the worker has never run", () => {
    expect(billingRunIsStale(null, NOW)).toBe(true);
    expect(billingRunIsStale(undefined, NOW)).toBe(true);
  });

  it("is fresh for a recent run (hourly cadence)", () => {
    expect(billingRunIsStale(hoursAgo(1), NOW)).toBe(false);
    expect(billingRunIsStale(hoursAgo(23), NOW)).toBe(false);
  });

  it("tolerates a legacy daily cadence without false-firing", () => {
    // A once-daily run ~24h apart must not trip the default 26h threshold.
    expect(billingRunIsStale(hoursAgo(24), NOW)).toBe(false);
    expect(billingRunIsStale(hoursAgo(25.9), NOW)).toBe(false);
  });

  it("is stale once past the threshold", () => {
    expect(billingRunIsStale(hoursAgo(BILLING_STALE_HOURS + 0.1), NOW)).toBe(true);
    expect(billingRunIsStale(hoursAgo(48), NOW)).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(billingRunIsStale(hoursAgo(3), NOW, 2)).toBe(true);
    expect(billingRunIsStale(hoursAgo(1), NOW, 2)).toBe(false);
  });

  it("treats a future timestamp (clock skew) as fresh, not stale", () => {
    expect(billingRunIsStale(hoursAgo(-5), NOW)).toBe(false);
  });
});
