import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Best-effort fixed-window IP rate limiter for the unauthenticated POST lanes
 * (portal/payer login, SMS-code sends, public apply). Counters live in the
 * `RateLimit` table, one row per (bucket, key, windowStart), incremented
 * ATOMICALLY via INSERT ... ON CONFLICT so a concurrent burst can't slip the
 * cap (a read-then-write would). The per-account lockouts in portal-auth /
 * payer-portal-auth are unchanged; this adds the IP dimension they lacked.
 *
 * Attribution depends on the client IP (clientIpFromXff, which honors
 * TRUSTED_PROXY_COUNT). A null key — no proxy set x-forwarded-for, e.g. local
 * dev — is NOT limited, matching the app's existing reliance on XFF.
 */
export interface RateLimitRule {
  /** Namespace so different lanes don't share a budget. */
  bucket: string;
  /** Max hits allowed within a window. */
  limit: number;
  /** Fixed-window length in milliseconds. */
  windowMs: number;
}

/** Pure: the start instant of the fixed window containing `now`. */
export function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Count one hit against (rule.bucket, key) in its current fixed window and
 * report whether it is still WITHIN the limit. Atomic. A null/empty key is not
 * limited (returns allowed). Never throws into the caller's flow — a limiter
 * failure must not take down login.
 */
export async function rateLimitHit(
  rule: RateLimitRule,
  key: string | null,
  now: Date = new Date(),
): Promise<{ allowed: boolean; count: number }> {
  if (!key) return { allowed: true, count: 0 };
  const ws = windowStartFor(now, rule.windowMs);
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      INSERT INTO "RateLimit" ("bucket", "key", "windowStart", "count")
      VALUES (${rule.bucket}, ${key}, ${ws}, 1)
      ON CONFLICT ("bucket", "key", "windowStart")
      DO UPDATE SET "count" = "RateLimit"."count" + 1
      RETURNING "count"
    `);
    const count = Number(rows[0]?.count ?? 1);
    return { allowed: count <= rule.limit, count };
  } catch (e) {
    // Fail OPEN: a limiter outage must never block legitimate logins. (The
    // per-account lockouts still apply underneath.)
    console.error("[rate-limit] counter update failed:", e);
    return { allowed: true, count: 0 };
  }
}

/** Delete windows older than `olderThan` (worker housekeeping). */
export async function cleanupRateLimits(olderThan: Date): Promise<number> {
  const res = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: olderThan } },
  });
  return res.count;
}

/** Rate-limit rules for the unauthenticated lanes. */
export const RATE_LIMITS = {
  /** Login ATTEMPTS (password/code) — blunts credential spray. Generous enough
   *  for NATed offices; an automated spray does far more. */
  authLogin: { bucket: "auth-login", limit: 15, windowMs: 10 * 60_000 },
  /** Outbound SMS / reset SENDS — blunts SMS toll-fraud and reset spam. */
  authSend: { bucket: "auth-send", limit: 5, windowMs: 15 * 60_000 },
  /** Public application submissions. */
  applySubmit: { bucket: "apply", limit: 10, windowMs: 60 * 60_000 },
  /** Public SMS opt-in submissions. */
  smsOptIn: { bucket: "sms-opt-in", limit: 10, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;
