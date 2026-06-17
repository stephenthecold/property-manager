import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "@/lib/providers/payment/stripe-signature";

const SECRET = "whsec_stripe";
const BODY = '{"id":"evt_1","type":"checkout.session.completed"}';

function header(body: string, tSeconds: number, secret = SECRET): string {
  const sig = createHmac("sha256", secret).update(`${tSeconds}.${body}`).digest("hex");
  return `t=${tSeconds},v1=${sig}`;
}

describe("verifyStripeSignature", () => {
  const tSec = Math.floor(1_700_000_000_000 / 1000);
  const nowMs = tSec * 1000;

  it("accepts a correctly signed, fresh payload", () => {
    expect(verifyStripeSignature(BODY, header(BODY, tSec), SECRET, { nowMs })).toBe(true);
  });

  it("accepts when one of several v1 signatures matches", () => {
    const good = createHmac("sha256", SECRET).update(`${tSec}.${BODY}`).digest("hex");
    const h = `t=${tSec},v1=deadbeef,v1=${good}`;
    expect(verifyStripeSignature(BODY, h, SECRET, { nowMs })).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifyStripeSignature(BODY, header(BODY, tSec, "other"), SECRET, { nowMs })).toBe(false);
  });

  it("rejects a tampered body", () => {
    const h = header(BODY, tSec);
    expect(verifyStripeSignature(BODY + " ", h, SECRET, { nowMs })).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const h = header(BODY, tSec);
    expect(verifyStripeSignature(BODY, h, SECRET, { nowMs: nowMs + 10 * 60 * 1000 })).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyStripeSignature(BODY, null, SECRET, { nowMs })).toBe(false);
    expect(verifyStripeSignature(BODY, "garbage", SECRET, { nowMs })).toBe(false);
    expect(verifyStripeSignature(BODY, `t=${tSec}`, SECRET, { nowMs })).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    expect(verifyStripeSignature(BODY, header(BODY, tSec), "", { nowMs })).toBe(false);
  });
});
