import { describe, expect, it } from "vitest";
import {
  CHECKOUT_TTL_MS,
  signCheckoutToken,
  verifyCheckoutToken,
} from "@/lib/providers/payment/checkout-token";

const SECRET = "whsec_test";
const NOW = 1_700_000_000_000;
const claims = { leaseId: "lease_abc", amountCents: "120000", nonce: "n1", iat: NOW };

describe("checkout-token", () => {
  it("round-trips signed claims", () => {
    const token = signCheckoutToken(claims, SECRET);
    expect(verifyCheckoutToken(token, SECRET, { nowMs: NOW })).toEqual(claims);
  });

  it("rejects a wrong secret", () => {
    const token = signCheckoutToken(claims, SECRET);
    expect(verifyCheckoutToken(token, "other")).toBeNull();
  });

  it("rejects a tampered amount", () => {
    const token = signCheckoutToken(claims, SECRET);
    const tampered = signCheckoutToken({ ...claims, amountCents: "1" }, SECRET);
    // Splice the tampered payload onto the original signature.
    const forged = `${tampered.split(".")[0]}.${token.split(".")[1]}`;
    expect(verifyCheckoutToken(forged, SECRET)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyCheckoutToken("nodot", SECRET)).toBeNull();
    expect(verifyCheckoutToken(".sig", SECRET)).toBeNull();
    expect(verifyCheckoutToken("payload.", SECRET)).toBeNull();
  });

  it("rejects a non-numeric amount claim", () => {
    const bad = signCheckoutToken({ ...claims, amountCents: "12.50" }, SECRET);
    expect(verifyCheckoutToken(bad, SECRET, { nowMs: NOW })).toBeNull();
  });

  it("accepts a token within the TTL window", () => {
    const token = signCheckoutToken(claims, SECRET);
    expect(
      verifyCheckoutToken(token, SECRET, { nowMs: NOW + CHECKOUT_TTL_MS - 1 }),
    ).toEqual(claims);
  });

  it("rejects an expired token", () => {
    const token = signCheckoutToken(claims, SECRET);
    expect(
      verifyCheckoutToken(token, SECRET, { nowMs: NOW + CHECKOUT_TTL_MS + 1 }),
    ).toBeNull();
  });

  it("rejects an implausibly future token (beyond clock skew)", () => {
    const future = signCheckoutToken({ ...claims, iat: NOW + 60 * 60 * 1000 }, SECRET);
    expect(verifyCheckoutToken(future, SECRET, { nowMs: NOW })).toBeNull();
  });

  it("rejects a token with no iat", () => {
    const noIat = signCheckoutToken(
      { leaseId: "l", amountCents: "100", nonce: "n" } as never,
      SECRET,
    );
    expect(verifyCheckoutToken(noIat, SECRET, { nowMs: NOW })).toBeNull();
  });
});
