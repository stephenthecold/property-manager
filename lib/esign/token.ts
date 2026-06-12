import { createHash, randomBytes } from "node:crypto";

/**
 * Signing-link tokens. A signer's link carries a 256-bit random token; only
 * its sha-256 hex digest is stored (SigningSigner.tokenHash, unique). Lookup
 * is BY the hash's uniqueness, so no constant-time comparison is needed — a
 * forged token simply hashes to a row that doesn't exist.
 */

export interface MintedSigningToken {
  /** 64 lowercase hex chars (32 random bytes) — the value embedded in the link. */
  token: string;
  /** sha-256 hex of the token — the only thing persisted. */
  tokenHash: string;
}

export function mintSigningToken(): MintedSigningToken {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashSigningToken(token) };
}

export function hashSigningToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const TOKEN_FORMAT = /^[0-9a-f]{64}$/;

/**
 * Cheap shape check (64 lowercase hex chars) so junk URLs are rejected before
 * any DB lookup. Uppercase is rejected on purpose: minted tokens are always
 * lowercase, and normalizing would create aliasing between distinct strings.
 */
export function isTokenFormatValid(token: string): boolean {
  return TOKEN_FORMAT.test(token);
}
