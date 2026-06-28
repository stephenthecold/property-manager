import { describe, it, expect, beforeAll } from "vitest";

/**
 * Tests for the keyed-HMAC proof helpers used to clear the 2FA login gate
 * through NextAuth's (client-influenced) session-update channel. A 32-byte KEK
 * must be present, so set one before importing the module under test.
 */
beforeAll(() => {
  // getEnv() validates the whole schema on first use; provide the minimum.
  process.env.SETTINGS_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
});

describe("hmacSign / hmacVerify", () => {
  it("verifies a freshly signed value and rejects tampering", async () => {
    const { hmacSign, hmacVerify } = await import("./crypto");
    const proof = hmacSign("2fa-verified:user_1:stampA");
    expect(hmacVerify("2fa-verified:user_1:stampA", proof)).toBe(true);
    // Different user, different stamp, empty proof, or a garbage proof -> false.
    expect(hmacVerify("2fa-verified:user_2:stampA", proof)).toBe(false);
    expect(hmacVerify("2fa-verified:user_1:stampB", proof)).toBe(false);
    expect(hmacVerify("2fa-verified:user_1:stampA", "")).toBe(false);
    expect(hmacVerify("2fa-verified:user_1:stampA", "AAAA")).toBe(false);
  });

  it("is deterministic for the same input but unguessable without the key", async () => {
    const { hmacSign } = await import("./crypto");
    const a = hmacSign("x");
    const b = hmacSign("x");
    expect(a).toBe(b);
    expect(a).not.toBe(hmacSign("y"));
    // base64 of a 32-byte SHA-256 digest.
    expect(Buffer.from(a, "base64")).toHaveLength(32);
  });
});

describe("twoFactorProof binding", () => {
  it("binds the proof to user id + security stamp (no cross-use/replay)", async () => {
    const { twoFactorProof, verifyTwoFactorProof } = await import("@/lib/services/totp");
    const proof = twoFactorProof("user_1", "stamp_1");
    expect(verifyTwoFactorProof("user_1", "stamp_1", proof)).toBe(true);
    // Wrong user, or a rotated stamp (post role-change/disable), invalidates it.
    expect(verifyTwoFactorProof("user_2", "stamp_1", proof)).toBe(false);
    expect(verifyTwoFactorProof("user_1", "stamp_2", proof)).toBe(false);
    expect(verifyTwoFactorProof("user_1", "stamp_1", "")).toBe(false);
  });
});
