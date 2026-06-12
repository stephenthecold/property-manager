import crypto from "node:crypto";
import type { FileStorage, PutObjectInput } from "@/lib/providers/storage/types";
import { getEnv } from "@/lib/config/env";

/**
 * At-rest encryption wrapper for the LOCAL storage provider — intended for
 * LOCAL_STORAGE_DIR pointed at a mounted network share (NFS/SMB), where the
 * share host shouldn't be able to read tenant documents.
 *
 * Format (per object): MAGIC(8) | nonce(12) | tag(16) | AES-256-GCM ciphertext.
 * `get` transparently passes through objects without the magic header, so files
 * written before encryption was enabled stay readable.
 *
 * Key: STORAGE_ENC_KEY (32 bytes, base64/hex) when set; otherwise an HKDF
 * subkey derived from SETTINGS_ENC_KEY — no new secret to manage, but the same
 * warning applies: losing the key makes stored files unrecoverable.
 *
 * Local-only by design: S3 presigned URLs hand bytes to the browser without
 * passing through the app, so a wrapper here could never decrypt them (use
 * SSE/bucket encryption for S3 instead).
 */

const MAGIC = Buffer.from("PMENCv1\0", "latin1"); // 8 bytes
const NONCE_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + NONCE_LEN + TAG_LEN;

function parseKey(raw: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("STORAGE_ENC_KEY must decode to exactly 32 bytes (base64 or hex).");
  }
  return key;
}

/** Resolve the file-encryption key (explicit env key, else HKDF of SETTINGS_ENC_KEY). */
export function storageEncryptionKey(): Buffer {
  const env = getEnv();
  if (env.STORAGE_ENC_KEY) return parseKey(env.STORAGE_ENC_KEY);
  if (!env.SETTINGS_ENC_KEY) {
    throw new Error(
      "STORAGE_ENCRYPT=true requires STORAGE_ENC_KEY or SETTINGS_ENC_KEY (32 random bytes, base64/hex).",
    );
  }
  const master = parseKey(env.SETTINGS_ENC_KEY);
  return Buffer.from(
    crypto.hkdfSync("sha256", master, Buffer.alloc(0), "pm-file-storage-v1", 32),
  );
}

export function encryptFileBuffer(plain: Buffer, key: Buffer): Buffer {
  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ct]);
}

export function isEncryptedFileBuffer(buf: Buffer): boolean {
  return buf.length >= HEADER_LEN && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Decrypt if the buffer carries our header; otherwise return it unchanged. */
export function maybeDecryptFileBuffer(buf: Buffer, key: Buffer): Buffer {
  if (!isEncryptedFileBuffer(buf)) return buf;
  const nonce = buf.subarray(MAGIC.length, MAGIC.length + NONCE_LEN);
  const tag = buf.subarray(MAGIC.length + NONCE_LEN, HEADER_LEN);
  const ct = buf.subarray(HEADER_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export class EncryptedFileStorage implements FileStorage {
  readonly name: string;
  private readonly inner: FileStorage;
  private readonly key: Buffer;

  constructor(inner: FileStorage, key?: Buffer) {
    this.inner = inner;
    this.key = key ?? storageEncryptionKey();
    this.name = `${inner.name}+encrypted`;
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    return this.inner.put({
      ...input,
      body: encryptFileBuffer(Buffer.from(input.body), this.key),
    });
  }

  async get(key: string): Promise<Buffer> {
    return maybeDecryptFileBuffer(await this.inner.get(key), this.key);
  }

  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    // Local signed URLs are served by /api/files, which decrypts via this module.
    return this.inner.getSignedUrl(key, expiresInSeconds);
  }

  async getSignedUploadUrl(): Promise<string> {
    throw new Error(
      "Encrypted storage does not support browser-direct uploads; POST the file to /api/uploads instead.",
    );
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }
}
