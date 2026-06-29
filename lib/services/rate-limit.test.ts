import { describe, it, expect } from "vitest";
import { windowStartFor, RATE_LIMITS } from "./rate-limit";

describe("windowStartFor", () => {
  const WIN = 10 * 60_000; // 10 minutes

  it("floors an instant to the start of its fixed window", () => {
    const start = new Date("2026-06-29T12:00:00.000Z");
    const mid = new Date("2026-06-29T12:07:31.000Z");
    const edge = new Date("2026-06-29T12:09:59.999Z");
    expect(windowStartFor(start, WIN).toISOString()).toBe("2026-06-29T12:00:00.000Z");
    expect(windowStartFor(mid, WIN).toISOString()).toBe("2026-06-29T12:00:00.000Z");
    expect(windowStartFor(edge, WIN).toISOString()).toBe("2026-06-29T12:00:00.000Z");
  });

  it("rolls to the next window at the boundary", () => {
    const next = new Date("2026-06-29T12:10:00.000Z");
    expect(windowStartFor(next, WIN).toISOString()).toBe("2026-06-29T12:10:00.000Z");
  });

  it("is stable: two instants in the same window share a start", () => {
    const a = new Date("2026-06-29T12:01:00.000Z");
    const b = new Date("2026-06-29T12:08:00.000Z");
    expect(windowStartFor(a, WIN).getTime()).toBe(windowStartFor(b, WIN).getTime());
  });

  it("ships sane rule shapes (positive limits + windows, distinct buckets)", () => {
    const rules = Object.values(RATE_LIMITS);
    for (const r of rules) {
      expect(r.limit).toBeGreaterThan(0);
      expect(r.windowMs).toBeGreaterThan(0);
    }
    const buckets = rules.map((r) => r.bucket);
    expect(new Set(buckets).size).toBe(buckets.length); // no shared budgets
  });
});
