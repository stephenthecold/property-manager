import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header) without the
 * Stripe SDK. Stripe signs `${timestamp}.${rawBody}` with the endpoint's signing
 * secret (HMAC-SHA256) and sends `t=<ts>,v1=<hex>[,v1=<hex>...]`. We recompute and
 * constant-time compare against each `v1`, and reject stale timestamps to block
 * replay. Pure: secret + clock are passed in, so it's unit-testable.
 *
 * https://stripe.com/docs/webhooks/signatures
 */

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

function parseHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) t = n;
    } else if (key === "v1") {
      v1.push(value);
    }
  }
  return { t, v1 };
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  opts: { nowMs?: number; toleranceMs?: number } = {},
): boolean {
  if (!header || !secret) return false;
  const { t, v1 } = parseHeader(header);
  if (t == null || v1.length === 0) return false;

  const nowMs = opts.nowMs ?? Date.now();
  const toleranceMs = opts.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  if (Math.abs(nowMs - t * 1000) > toleranceMs) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  return v1.some((candidate) => hexEqual(candidate, expected));
}
