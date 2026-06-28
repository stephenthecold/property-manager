import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared-secret authentication for the email bounce/complaint webhook, mirroring
 * the payment-gateway webhook (lib/providers/payment/stub.ts `verifySignature`):
 * the sender computes `HMAC-SHA256(secret, rawBody)` as lower-case hex and sends
 * it in a header; we recompute over the exact bytes we received and compare in
 * constant time. Pure — no env, no clock — so it is unit-testable with fixed
 * vectors. FAILS CLOSED: with no configured secret (or no provided signature)
 * there is no legitimate caller, so every request is rejected.
 */

/** Lower-case hex `HMAC-SHA256(secret, rawBody)`. */
export function computeBounceSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyBounceSignature(i: {
  secret: string | null | undefined;
  rawBody: string;
  signature: string | null | undefined;
}): boolean {
  // Fail closed: unauthenticated requests are never accepted.
  if (!i.secret) return false;
  if (!i.signature) return false;
  const expected = Buffer.from(computeBounceSignature(i.secret, i.rawBody));
  // Some providers prefix the scheme ("sha256="); accept either spelling.
  const provided = Buffer.from(i.signature.trim().replace(/^sha256=/i, ""));
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
