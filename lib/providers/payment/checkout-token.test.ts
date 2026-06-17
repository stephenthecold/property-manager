import { describe, expect, it } from "vitest";
import {
  signCheckoutToken,
  verifyCheckoutToken,
} from "@/lib/providers/payment/checkout-token";

const SECRET = "whsec_test";
const claims = { leaseId: "lease_abc", amountCents: "120000", nonce: "n1" };

describe("checkout-token", () => {
  it("round-trips signed claims", () => {
    const token = signCheckoutToken(claims, SECRET);
    expect(verifyCheckoutToken(token, SECRET)).toEqual(claims);
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
    const bad = signCheckoutToken(
      { ...claims, amountCents: "12.50" },
      SECRET,
    );
    expect(verifyCheckoutToken(bad, SECRET)).toBeNull();
  });
});
