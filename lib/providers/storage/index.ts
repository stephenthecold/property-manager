import { getEnv } from "@/lib/config/env";
import type { FileStorage } from "@/lib/providers/storage/types";
import { StubFileStorage } from "@/lib/providers/storage/stub";
import { S3FileStorage } from "@/lib/providers/storage/s3";
import { LocalFileStorage } from "@/lib/providers/storage/local";
import { EncryptedFileStorage } from "@/lib/providers/storage/encrypted";

export type { FileStorage } from "@/lib/providers/storage/types";

let cached: FileStorage | null = null;

/**
 * Returns the configured file storage (stub by default). With
 * STORAGE_ENCRYPT=true the local provider is wrapped with at-rest AES-256-GCM
 * (network-share friendly); S3 should use bucket/SSE encryption instead since
 * presigned URLs bypass the app.
 */
export function getFileStorage(): FileStorage {
  if (cached) return cached;
  const env = getEnv();
  const provider = env.STORAGE_PROVIDER;
  cached =
    provider === "s3"
      ? new S3FileStorage()
      : provider === "local"
        ? env.STORAGE_ENCRYPT
          ? new EncryptedFileStorage(new LocalFileStorage())
          : new LocalFileStorage()
        : new StubFileStorage();
  return cached;
}

/** Test helper: clear the memoized storage so a new provider can be constructed. */
export function resetFileStorageCache(): void {
  cached = null;
}
