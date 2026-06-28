import { describe, it, expect } from "vitest";
import {
  computeBounceSignature,
  verifyBounceSignature,
} from "@/lib/email/bounce-signature";

const SECRET = "test-bounce-secret";
const BODY = JSON.stringify({ type: "bounce", email: "a@b.co" });

describe("verifyBounceSignature", () => {
  it("accepts a correctly-signed body", () => {
    const sig = computeBounceSignature(SECRET, BODY);
    expect(verifyBounceSignature({ secret: SECRET, rawBody: BODY, signature: sig })).toBe(true);
  });

  it("accepts a 'sha256=' scheme prefix", () => {
    const sig = computeBounceSignature(SECRET, BODY);
    expect(
      verifyBounceSignature({ secret: SECRET, rawBody: BODY, signature: `sha256=${sig}` }),
    ).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(
      verifyBounceSignature({ secret: SECRET, rawBody: BODY, signature: "deadbeef" }),
    ).toBe(false);
  });

  it("rejects when the body was tampered with (sig no longer matches)", () => {
    const sig = computeBounceSignature(SECRET, BODY);
    const tampered = JSON.stringify({ type: "bounce", email: "attacker@evil.co" });
    expect(
      verifyBounceSignature({ secret: SECRET, rawBody: tampered, signature: sig }),
    ).toBe(false);
  });

  it("rejects when signed with a different secret", () => {
    const sig = computeBounceSignature("other-secret", BODY);
    expect(verifyBounceSignature({ secret: SECRET, rawBody: BODY, signature: sig })).toBe(false);
  });

  it("FAILS CLOSED with no configured secret", () => {
    const sig = computeBounceSignature(SECRET, BODY);
    expect(verifyBounceSignature({ secret: null, rawBody: BODY, signature: sig })).toBe(false);
    expect(verifyBounceSignature({ secret: undefined, rawBody: BODY, signature: sig })).toBe(false);
    expect(verifyBounceSignature({ secret: "", rawBody: BODY, signature: sig })).toBe(false);
  });

  it("FAILS CLOSED with no provided signature", () => {
    expect(verifyBounceSignature({ secret: SECRET, rawBody: BODY, signature: null })).toBe(false);
    expect(verifyBounceSignature({ secret: SECRET, rawBody: BODY, signature: "" })).toBe(false);
  });
});
