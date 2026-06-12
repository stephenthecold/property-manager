import { getEnv } from "@/lib/config/env";

/**
 * Real client IP from x-forwarded-for honoring TRUSTED_PROXY_COUNT: each
 * trusted hop appends the peer it received from, so the trustworthy client
 * entry is the Nth from the END (N = trusted proxies, min 1). Earlier entries
 * are caller-supplied and spoofable.
 */
export function clientIpFromXff(xff: string | null): string | null {
  if (!xff) return null;
  const hops = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;
  const trusted = Math.min(Math.max(getEnv().TRUSTED_PROXY_COUNT, 1), hops.length);
  return hops[hops.length - trusted] ?? null;
}
