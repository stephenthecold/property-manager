import type { FileStorage } from "@/lib/providers/storage/types";
import { StubFileStorage } from "@/lib/providers/storage/stub";
import { S3FileStorage } from "@/lib/providers/storage/s3";
import { LocalFileStorage } from "@/lib/providers/storage/local";
import { EncryptedFileStorage } from "@/lib/providers/storage/encrypted";
import { resolveStorageConfig } from "@/lib/services/storage-config";

export type { FileStorage } from "@/lib/providers/storage/types";

let cached: { key: string; storage: FileStorage } | null = null;

/**
 * Returns the configured file storage. The provider + non-secret S3 params come
 * from a DB-over-env resolve (Settings → Organization); secrets, the local dir,
 * and the encrypt flag stay in env. The constructed provider is memoized by a
 * non-secret config signature, so changing the config in Settings rebuilds it
 * on the next call (the app-settings cache is invalidated on save).
 *
 * With STORAGE_ENCRYPT=true the local provider is wrapped with at-rest
 * AES-256-GCM (network-share friendly); S3 should use bucket/SSE encryption
 * instead since presigned URLs bypass the app.
 */
export async function getFileStorage(): Promise<FileStorage> {
  const cfg = await resolveStorageConfig();
  if (cached && cached.key === cfg.cacheKey) return cached.storage;

  let storage: FileStorage;
  if (cfg.provider === "s3") {
    storage = new S3FileStorage(cfg.s3);
  } else if (cfg.provider === "local") {
    storage = cfg.encrypt
      ? new EncryptedFileStorage(new LocalFileStorage())
      : new LocalFileStorage();
  } else {
    storage = new StubFileStorage();
  }
  cached = { key: cfg.cacheKey, storage };
  return storage;
}

/** Test helper: clear the memoized storage so a new provider can be constructed. */
export function resetFileStorageCache(): void {
  cached = null;
}
