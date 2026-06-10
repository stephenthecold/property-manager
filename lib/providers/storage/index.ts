import { getEnv } from "@/lib/config/env";
import type { FileStorage } from "@/lib/providers/storage/types";
import { StubFileStorage } from "@/lib/providers/storage/stub";
import { S3FileStorage } from "@/lib/providers/storage/s3";

export type { FileStorage } from "@/lib/providers/storage/types";

let cached: FileStorage | null = null;

/** Returns the configured file storage (stub by default). */
export function getFileStorage(): FileStorage {
  if (cached) return cached;
  const provider = getEnv().STORAGE_PROVIDER;
  cached = provider === "s3" ? new S3FileStorage() : new StubFileStorage();
  return cached;
}
