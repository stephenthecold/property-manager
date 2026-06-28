import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateSecret,
  generateTotp,
  verifyTotp,
  otpauthUrl,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
  normalizeBackupCode,
  unusedBackupCodeCount,
} from "./totp";

/**
 * RFC 6238 Appendix B test vectors use the ASCII seed "12345678901234567890"
 * (20 bytes) for HMAC-SHA-1. The published 8-digit TOTP values are below; this
 * module produces 6 digits, so we assert the LAST 6 digits of each vector (the
 * truncation modulo only differs in the leading digits).
 */
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, "utf8"));

// time (seconds) -> RFC 6238 8-digit SHA-1 TOTP
const RFC_VECTORS: { time: number; totp8: string }[] = [
  { time: 59, totp8: "94287082" },
  { time: 1111111109, totp8: "07081804" },
  { time: 1111111111, totp8: "14050471" },
  { time: 1234567890, totp8: "89005924" },
  { time: 2000000000, totp8: "69279037" },
  { time: 20000000000, totp8: "65353130" },
];

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 128, 64, 17]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it("encodes the RFC seed to a known prefix and decodes back", () => {
    // "12345678901234567890" -> base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    expect(RFC_SECRET_BASE32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET_BASE32).toString("utf8")).toBe(RFC_SECRET_ASCII);
  });

  it("is case-insensitive and tolerates padding/whitespace", () => {
    const enc = base32Encode(Buffer.from("hello"));
    expect(base32Decode(enc.toLowerCase()).toString()).toBe("hello");
    expect(base32Decode(`${enc}===`).toString()).toBe("hello");
    expect(base32Decode(` ${enc} `).toString()).toBe("hello");
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("0189!")).toThrow();
  });
});

describe("generateTotp — RFC 6238 vectors (last 6 digits)", () => {
  for (const { time, totp8 } of RFC_VECTORS) {
    it(`matches at t=${time}s`, () => {
      const at = new Date(time * 1000);
      const expected6 = totp8.slice(-6);
      expect(generateTotp(RFC_SECRET_BASE32, at)).toBe(expected6);
    });
  }
});

describe("verifyTotp", () => {
  it("accepts the current code", () => {
    const at = new Date(59 * 1000);
    const code = generateTotp(RFC_SECRET_BASE32, at);
    expect(verifyTotp(RFC_SECRET_BASE32, code, at)).toBe(true);
  });

  it("accepts a code from the previous and next step (±1 window, clock skew)", () => {
    const at = new Date(1111111109 * 1000);
    const prev = generateTotp(RFC_SECRET_BASE32, new Date(at.getTime() - 30_000));
    const next = generateTotp(RFC_SECRET_BASE32, new Date(at.getTime() + 30_000));
    expect(verifyTotp(RFC_SECRET_BASE32, prev, at)).toBe(true);
    expect(verifyTotp(RFC_SECRET_BASE32, next, at)).toBe(true);
  });

  it("rejects a code two steps away (outside the window)", () => {
    const at = new Date(1111111109 * 1000);
    const far = generateTotp(RFC_SECRET_BASE32, new Date(at.getTime() - 60_000));
    expect(verifyTotp(RFC_SECRET_BASE32, far, at)).toBe(false);
  });

  it("rejects a wrong code, blank, and malformed input (fails closed)", () => {
    const at = new Date(59 * 1000);
    expect(verifyTotp(RFC_SECRET_BASE32, "000000", at)).toBe(false);
    expect(verifyTotp(RFC_SECRET_BASE32, "", at)).toBe(false);
    expect(verifyTotp(RFC_SECRET_BASE32, "12345", at)).toBe(false); // too short
    expect(verifyTotp(RFC_SECRET_BASE32, "1234567", at)).toBe(false); // too long
    expect(verifyTotp(RFC_SECRET_BASE32, "abcdef", at)).toBe(false); // non-digit
  });

  it("tolerates spaces in the entered code", () => {
    const at = new Date(59 * 1000);
    const code = generateTotp(RFC_SECRET_BASE32, at);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET_BASE32, spaced, at)).toBe(true);
  });

  it("rejects everything when the secret is not valid base32 (fails closed)", () => {
    expect(verifyTotp("!!!notbase32!!!", "123456", new Date())).toBe(false);
  });

  /**
   * Replay: a valid code stays valid for its whole window. This module does not
   * track a consumed step, so the SAME code verifies true twice within the
   * window — documented behaviour, asserted so a future change is intentional.
   */
  it("a TOTP code is replayable within its window (documented)", () => {
    const at = new Date(59 * 1000);
    const code = generateTotp(RFC_SECRET_BASE32, at);
    expect(verifyTotp(RFC_SECRET_BASE32, code, at)).toBe(true);
    expect(verifyTotp(RFC_SECRET_BASE32, code, at)).toBe(true);
  });
});

describe("generateSecret / otpauthUrl", () => {
  it("generates a decodable base32 secret of the expected length", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(secret).length).toBe(20);
    // A freshly generated secret verifies its own current code.
    const now = new Date();
    expect(verifyTotp(secret, generateTotp(secret, now), now)).toBe(true);
  });

  it("builds a spec-compliant otpauth URL with issuer + account", () => {
    const url = otpauthUrl(RFC_SECRET_BASE32, "alice@example.com", "Acme Rentals");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    const parsed = new URL(url);
    // The URL host is "totp"; the label is the (decoded) pathname.
    expect(parsed.host).toBe("totp");
    expect(decodeURIComponent(parsed.pathname)).toBe("/Acme Rentals:alice@example.com");
    expect(parsed.searchParams.get("secret")).toBe(RFC_SECRET_BASE32);
    expect(parsed.searchParams.get("issuer")).toBe("Acme Rentals");
    expect(parsed.searchParams.get("algorithm")).toBe("SHA1");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
  });
});

describe("backup codes", () => {
  it("generates the requested count of distinct, well-formed codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    expect(new Set(codes).size).toBe(10); // no collisions
  });

  it("normalizes codes (case, dashes, spaces) consistently", () => {
    expect(normalizeBackupCode("AB12C-d34EF")).toBe("ab12cd34ef");
    expect(normalizeBackupCode("ab12c d34ef")).toBe("ab12cd34ef");
  });

  it("hashes codes and consumes a valid one exactly once (no replay)", async () => {
    const codes = generateBackupCodes(3);
    const stored = await hashBackupCodes(codes);
    expect(unusedBackupCodeCount(stored)).toBe(3);

    // First use of a real code succeeds and marks it used.
    const after = await consumeBackupCode(stored, codes[1]);
    expect(after).not.toBeNull();
    expect(unusedBackupCodeCount(after!)).toBe(2);
    expect(after![1].usedAt).not.toBeNull();

    // Re-using the SAME code against the updated store fails (consumed).
    expect(await consumeBackupCode(after!, codes[1])).toBeNull();

    // A different unused code still works.
    const after2 = await consumeBackupCode(after!, codes[0]);
    expect(after2).not.toBeNull();
    expect(unusedBackupCodeCount(after2!)).toBe(1);
  });

  it("rejects an unknown or malformed backup code (fails closed)", async () => {
    const codes = generateBackupCodes(2);
    const stored = await hashBackupCodes(codes);
    expect(await consumeBackupCode(stored, "00000-00000")).toBeNull();
    expect(await consumeBackupCode(stored, "not-a-code")).toBeNull();
    expect(await consumeBackupCode(stored, "")).toBeNull();
  });

  it("accepts a code entered with different casing/format", async () => {
    const codes = generateBackupCodes(1);
    const stored = await hashBackupCodes(codes);
    const formatted = codes[0].toUpperCase().replace("-", " ");
    expect(await consumeBackupCode(stored, formatted)).not.toBeNull();
  });

  it("unusedBackupCodeCount tolerates null/garbage", () => {
    expect(unusedBackupCodeCount(null)).toBe(0);
    expect(unusedBackupCodeCount(undefined)).toBe(0);
    // @ts-expect-error — runtime robustness against malformed JSON
    expect(unusedBackupCodeCount([null, { usedAt: null }, { usedAt: "x" }])).toBe(1);
  });
});
