import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { rateLimitHit, cleanupRateLimits } from "@/lib/services/rate-limit";

/**
 * Integration test (real Postgres): the fixed-window counter increments
 * atomically, enforces the cap per key/window, and prunes old windows.
 */

const BUCKET = `itest-rl-${Math.random().toString(36).slice(2, 8)}`;
const rule = { bucket: BUCKET, limit: 3, windowMs: 60_000 };
const now = new Date("2026-06-29T12:00:30.000Z");

afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { bucket: BUCKET } });
  await prisma.$disconnect();
});

describe("rateLimitHit", () => {
  it("allows up to the limit, then blocks, counting atomically", async () => {
    const key = "1.2.3.4";
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimitHit(rule, key, now));
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4, 5]);
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
  });

  it("scopes the budget per key", async () => {
    const r = await rateLimitHit(rule, "9.9.9.9", now);
    expect(r).toEqual({ allowed: true, count: 1 });
  });

  it("resets in the next window", async () => {
    const key = "5.6.7.8";
    for (let i = 0; i < 3; i++) await rateLimitHit(rule, key, now);
    expect((await rateLimitHit(rule, key, now)).allowed).toBe(false);
    const next = await rateLimitHit(rule, key, new Date(now.getTime() + 60_000));
    expect(next).toEqual({ allowed: true, count: 1 });
  });

  it("never limits a null key (no attributable client IP)", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await rateLimitHit(rule, null, now)).allowed).toBe(true);
    }
  });

  it("concurrent hits on one key still count exactly (atomic increment)", async () => {
    const key = "7.7.7.7";
    const burst = await Promise.all(
      Array.from({ length: 10 }, () => rateLimitHit(rule, key, now)),
    );
    // Exactly one hit observed each of counts 1..10 — none lost to a race.
    expect(burst.map((r) => r.count).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(burst.filter((r) => r.allowed)).toHaveLength(3); // only the first 3
  });

  it("cleanupRateLimits removes windows older than the cutoff", async () => {
    const key = "10.0.0.1";
    await rateLimitHit(rule, key, new Date("2026-06-20T00:00:00.000Z")); // old
    await rateLimitHit(rule, key, now); // recent
    const cutoff = new Date("2026-06-25T00:00:00.000Z");
    const removed = await cleanupRateLimits(cutoff);
    expect(removed).toBeGreaterThanOrEqual(1);
    const survivors = await prisma.rateLimit.findMany({ where: { bucket: BUCKET, key } });
    expect(survivors.every((s) => s.windowStart >= cutoff)).toBe(true);
  });
});
