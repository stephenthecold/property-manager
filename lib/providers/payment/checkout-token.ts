import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed checkout token for the STUB gateway's dev-simulated hosted checkout.
 * A real provider wouldn't use this — it returns its own hosted-checkout URL and
 * posts a real webhook. The stub instead encodes the (leaseId, amountCents) in
 * an HMAC-signed token so the in-app confirm page can verify the amount/lease
 * weren't tampered with before recording a (simulated) payment. Pure: the secret
 * is passed in, so it's unit-testable and never reads env here.
 */

export interface CheckoutClaims {
  leaseId: string;
  /** Integer cents as a string (no floats cross this boundary). */
  amountCents: string;
  /** Random per-checkout, so each token (and its derived event id) is unique. */
  nonce: string;
  /** Issued-at epoch ms — bounds how long a captured token stays redeemable. */
  iat: number;
}

/** How long a checkout token stays valid after issuance. */
export const CHECKOUT_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** Tolerance for issuer/verifier clock skew on the future side. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** `<base64url(json)>.<hex hmac>`. */
export function signCheckoutToken(claims: CheckoutClaims, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `${payload}.${hmac(payload, secret)}`;
}

/**
 * Verify + parse a token; null on any tampering/format/secret mismatch, OR if
 * the token is older than `maxAgeMs` (or implausibly future). `nowMs` is
 * injectable so this stays pure and unit-testable; it defaults to the wall clock.
 */
export function verifyCheckoutToken(
  token: string,
  secret: string,
  opts: { nowMs?: number; maxAgeMs?: number } = {},
): CheckoutClaims | null {
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? CHECKOUT_TTL_MS;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(payload).toString("utf8")) as unknown;
    if (!data || typeof data !== "object") return null;
    const o = data as Record<string, unknown>;
    if (
      typeof o.leaseId !== "string" ||
      typeof o.amountCents !== "string" ||
      typeof o.nonce !== "string" ||
      typeof o.iat !== "number" ||
      !Number.isFinite(o.iat) ||
      !/^\d+$/.test(o.amountCents)
    ) {
      return null;
    }
    // Expired, or issued implausibly far in the future (clock skew tolerated).
    if (nowMs - o.iat > maxAgeMs || o.iat - nowMs > CLOCK_SKEW_MS) return null;
    return {
      leaseId: o.leaseId,
      amountCents: o.amountCents,
      nonce: o.nonce,
      iat: o.iat,
    };
  } catch {
    return null;
  }
}
