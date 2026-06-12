import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  hashSigningToken,
  isTokenFormatValid,
  mintSigningToken,
} from "@/lib/esign/token";

describe("mintSigningToken", () => {
  it("produces a valid-format token whose hash matches hashSigningToken", () => {
    const { token, tokenHash } = mintSigningToken();
    expect(isTokenFormatValid(token)).toBe(true);
    expect(tokenHash).toBe(hashSigningToken(token));
    // The stored hash is itself 64 hex chars (sha-256).
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mints distinct tokens", () => {
    const a = mintSigningToken();
    const b = mintSigningToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe("hashSigningToken", () => {
  it("is deterministic and matches node's sha256", () => {
    const token = "ab".repeat(32);
    const expected = createHash("sha256").update(token, "utf8").digest("hex");
    expect(hashSigningToken(token)).toBe(expected);
    expect(hashSigningToken(token)).toBe(hashSigningToken(token));
  });

  it("different tokens hash differently", () => {
    expect(hashSigningToken("a".repeat(64))).not.toBe(
      hashSigningToken("b".repeat(64)),
    );
  });
});

describe("isTokenFormatValid", () => {
  it("accepts 64 lowercase hex chars", () => {
    expect(isTokenFormatValid("0123456789abcdef".repeat(4))).toBe(true);
  });

  it("rejects junk, short, long, uppercase, and empty values", () => {
    expect(isTokenFormatValid("")).toBe(false);
    expect(isTokenFormatValid("not-a-token")).toBe(false);
    expect(isTokenFormatValid("abc123")).toBe(false); // too short
    expect(isTokenFormatValid("a".repeat(63))).toBe(false);
    expect(isTokenFormatValid("a".repeat(65))).toBe(false);
    expect(isTokenFormatValid("A".repeat(64))).toBe(false); // uppercase
    expect(isTokenFormatValid("g".repeat(64))).toBe(false); // non-hex
    expect(isTokenFormatValid(`${"a".repeat(63)}\n`)).toBe(false);
  });
});
