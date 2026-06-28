import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/auth/crypto";

/**
 * Pure RFC 6238 TOTP (time-based one-time passwords) + RFC 4648 base32, plus
 * one-time backup codes. Used for optional staff 2FA.
 *
 * Algorithm parameters are the universal authenticator defaults (Google
 * Authenticator, Authy, 1Password, …): HMAC-SHA-1, 6 digits, 30-second step.
 * Verification accepts a ±1 step window (the previous, current, and next code)
 * to tolerate clock skew and a code typed right at a boundary.
 *
 * Node `node:crypto` only — no third-party TOTP/QR dependency. The otpauth URL
 * is rendered as text + a link (and optionally a QR) by the UI.
 *
 * Replay note: TOTP is inherently replayable WITHIN its validity window — a code
 * stays valid for ~30-90s. This module does not track "last used step" (that is
 * a per-account stateful concern); a stricter deployment could persist the last
 * accepted step and reject codes <= it. For this app the short window + the
 * one-time backup codes (which ARE consumed) are the chosen trade-off.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // accept current ± this many steps
const ALGORITHM = "sha1";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648, no padding

/** Encode bytes to unpadded base32 (RFC 4648) — the authenticator key format. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/** Decode an unpadded/padded, case-insensitive base32 string to bytes. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generate a new random TOTP secret as a base32 string. 20 bytes (160 bits) is
 * the RFC-recommended size for an HMAC-SHA-1 key.
 */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

/** The HOTP value for a given counter and (decoded) key — RFC 4226 §5.3. */
function hotp(key: Buffer, counter: number): string {
  // 8-byte big-endian counter.
  const buf = Buffer.alloc(8);
  // counter is well within 2^53; write high and low 32-bit words.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac(ALGORITHM, key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, "0");
}

/** The counter (step number) for a given time. */
function counterFor(atDate: Date): number {
  return Math.floor(atDate.getTime() / 1000 / STEP_SECONDS);
}

/**
 * The current TOTP code for a base32 secret at `atDate` (clock-injected for
 * tests; defaults to now). Returns a zero-padded 6-digit string.
 */
export function generateTotp(secretBase32: string, atDate: Date = new Date()): string {
  return hotp(base32Decode(secretBase32), counterFor(atDate));
}

/**
 * Verify a user-supplied code against the secret, accepting the ±WINDOW steps
 * around `atDate`. Constant-time per-candidate comparison; non-digit/blank
 * input is rejected. Returns true only on an exact match.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atDate: Date = new Date(),
): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const center = counterFor(atDate);
  const candidate = Buffer.from(cleaned, "utf8");
  let matched = false;
  // Check every step in the window WITHOUT early-exit, so timing does not leak
  // which step matched.
  for (let i = -WINDOW; i <= WINDOW; i++) {
    const expected = Buffer.from(hotp(key, center + i), "utf8");
    if (
      expected.length === candidate.length &&
      crypto.timingSafeEqual(expected, candidate)
    ) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Build the otpauth:// provisioning URI for a QR code (RFC, "Key Uri Format").
 * `account` identifies the user (their email); `issuer` is the org/brand.
 */
export function otpauthUrl(
  secretBase32: string,
  account: string,
  issuer: string,
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- Backup (recovery) codes -------------------------------------------------

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5; // 10 hex chars

/**
 * Generate N human-friendly one-time backup codes (lowercase hex, grouped as
 * "xxxxx-xxxxx" for readability). Returned in PLAINTEXT to show the user once;
 * persist only their hashes via {@link hashBackupCodes}.
 */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const hex = crypto.randomBytes(BACKUP_CODE_BYTES).toString("hex");
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });
}

/** Normalize a backup code for hashing/verification (lowercase, dashes/space stripped). */
export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]+/g, "");
}

/**
 * Hash backup codes for storage (argon2id, reusing the app password hasher).
 * Each entry is `{ hash, usedAt }`; `usedAt` is set when a code is consumed so
 * a code can never be replayed. Store the returned array as JSON on the user.
 */
export interface StoredBackupCode {
  hash: string;
  usedAt: string | null;
}

export async function hashBackupCodes(codes: string[]): Promise<StoredBackupCode[]> {
  return Promise.all(
    codes.map(async (c) => ({
      hash: await hashPassword(normalizeBackupCode(c)),
      usedAt: null,
    })),
  );
}

/**
 * Try to consume one backup code. Returns the updated array (with the matched
 * code marked used) on success, or null if no UNUSED code matched. Pure —
 * persisting the returned array is the caller's job (so it can run in a tx).
 */
export async function consumeBackupCode(
  stored: StoredBackupCode[],
  code: string,
): Promise<StoredBackupCode[] | null> {
  const normalized = normalizeBackupCode(code);
  if (!/^[0-9a-f]{10}$/.test(normalized)) return null;
  for (let i = 0; i < stored.length; i++) {
    const entry = stored[i];
    if (entry.usedAt) continue;
    if (await verifyPassword(entry.hash, normalized)) {
      const next = stored.slice();
      next[i] = { ...entry, usedAt: new Date().toISOString() };
      return next;
    }
  }
  return null;
}

/** Count remaining (unused) backup codes — for the "N codes left" UI. */
export function unusedBackupCodeCount(stored: StoredBackupCode[] | null | undefined): number {
  if (!Array.isArray(stored)) return 0;
  return stored.filter((c) => c && typeof c === "object" && !c.usedAt).length;
}
