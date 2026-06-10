import crypto from "node:crypto";
import argon2 from "argon2";
import { getEnv } from "@/lib/config/env";

/**
 * Cryptographic helpers for auth: AES-256-GCM for the OIDC client secret at rest,
 * argon2id for passphrases, and timing-safe comparisons. Node runtime only.
 */

function kek(): Buffer {
  const raw = getEnv().SETTINGS_ENC_KEY;
  if (!raw) {
    throw new Error(
      "SETTINGS_ENC_KEY is required to encrypt/decrypt OIDC secrets. Generate 32 random bytes (base64 or hex).",
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SETTINGS_ENC_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export interface Encrypted {
  ciphertext: string; // base64
  nonce: string; // base64 (12-byte GCM IV, unique per encryption)
  tag: string; // base64 (GCM auth tag)
}

/** Encrypt with a fresh random nonce and AAD binding the ciphertext to its field/row. */
export function encryptSecret(plaintext: string, aad: string): Encrypted {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    nonce: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(enc: Encrypted, aad: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    kek(),
    Buffer.from(enc.nonce, "base64"),
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** A throwaway hash to keep the failure path constant-time when no credential exists. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3Q8m2k8q9b0Z0m0kqf0xq0m0kqf0xq0m0kqf0xq0m00";

export async function dummyVerify(plain: string): Promise<void> {
  try {
    await argon2.verify(DUMMY_HASH, plain);
  } catch {
    /* always fails; only here to spend comparable time */
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}
