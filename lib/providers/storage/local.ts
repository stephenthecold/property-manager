import { createHmac, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage, PutObjectInput } from "@/lib/providers/storage/types";
import { getEnv } from "@/lib/config/env";

/**
 * Local-disk storage (single-node, dev/small installs). Objects live under
 * LOCAL_STORAGE_DIR; "signed URLs" point at /api/files with an HMAC the route
 * verifies via {@link verifyLocalFileSignature}.
 */

const SAFE_KEY = /^[A-Za-z0-9/_.-]+$/;

/** Reject path traversal / absolute paths / anything outside [A-Za-z0-9/_.-]. */
export function assertSafeStorageKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("..") ||
    !SAFE_KEY.test(key)
  ) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
  }
}

function resolveBaseDir(baseDir?: string): string {
  return path.resolve(process.cwd(), baseDir ?? getEnv().LOCAL_STORAGE_DIR);
}

/** Absolute on-disk path for a key under the configured base dir (for the file-serving route). */
export function localFilePath(key: string): string {
  assertSafeStorageKey(key);
  return path.join(resolveBaseDir(), key);
}

function signature(key: string, exp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${key}\n${exp}`).digest("hex");
}

/** Verify a /api/files signature. False on expiry, tampering, or malformed input. */
export function verifyLocalFileSignature(i: {
  key: string;
  exp: string;
  sig: string;
  secret?: string;
}): boolean {
  const secret = i.secret ?? getEnv().AUTH_SECRET;
  if (!secret) return false;
  try {
    assertSafeStorageKey(i.key);
  } catch {
    return false;
  }
  if (!/^\d{1,15}$/.test(i.exp)) return false;
  if (Number(i.exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signature(i.key, i.exp, secret), "hex");
  const actual = Buffer.from(i.sig, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export class LocalFileStorage implements FileStorage {
  readonly name = "local";
  private readonly baseDir: string;
  private readonly secret: string;

  constructor(opts?: { baseDir?: string; secret?: string }) {
    this.baseDir = resolveBaseDir(opts?.baseDir);
    const secret = opts?.secret ?? getEnv().AUTH_SECRET;
    if (!secret) {
      throw new Error(
        "AUTH_SECRET is required when STORAGE_PROVIDER=local (download URLs are HMAC-signed).",
      );
    }
    this.secret = secret;
  }

  private filePath(key: string): string {
    assertSafeStorageKey(key);
    return path.join(this.baseDir, key);
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    const filePath = this.filePath(input.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    return { key: input.key };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.filePath(key));
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    assertSafeStorageKey(key);
    const exp = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
    const sig = signature(key, exp, this.secret);
    return `/api/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  async getSignedUploadUrl(key: string): Promise<string> {
    assertSafeStorageKey(key);
    throw new Error(
      "Local storage does not support browser-direct uploads; POST the file to /api/uploads instead.",
    );
  }

  async delete(key: string): Promise<void> {
    // Idempotent like S3 DeleteObject: deleting a missing key is not an error.
    await rm(this.filePath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.filePath(key);
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
