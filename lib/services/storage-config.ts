import { getEnv } from "@/lib/config/env";
import { getAppSettings } from "@/lib/services/app-settings";

/**
 * Resolve the effective file-storage config by merging NON-SECRET DB overrides
 * (Settings → Organization) over the environment, mirroring the SMS DB-over-env
 * pattern. Secrets (S3 keys, STORAGE_ENC_KEY), the local dir, and the encrypt
 * flag are env-only. When no DB override is set this returns exactly the env
 * values, so existing deployments behave identically.
 */

export type StorageProvider = "stub" | "s3" | "local";

export interface ResolvedStorageConfig {
  provider: StorageProvider;
  encrypt: boolean; // env-only
  localDir: string; // env-only (woven into the /api/files signing path)
  s3: {
    bucket: string | null;
    region: string | null;
    endpoint: string | null;
    forcePathStyle: boolean;
    accessKeyId: string | null; // env-only (secret)
    secretAccessKey: string | null; // env-only (secret)
  };
  /** Non-secret signature for memoizing the constructed provider. */
  cacheKey: string;
  /** "db" when any non-secret field came from the DB, else "env". */
  source: "db" | "env";
}

function nonEmpty(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

export async function resolveStorageConfig(): Promise<ResolvedStorageConfig> {
  const env = getEnv();
  const s = await getAppSettings();

  const dbProvider = nonEmpty(s.storageProvider);
  const dbBucket = nonEmpty(s.s3Bucket);
  const dbRegion = nonEmpty(s.s3Region);
  const dbEndpoint = nonEmpty(s.s3Endpoint);

  const provider = (dbProvider ?? env.STORAGE_PROVIDER) as StorageProvider;
  const bucket = dbBucket ?? env.S3_BUCKET ?? null;
  const region = dbRegion ?? env.S3_REGION ?? null;
  const endpoint = dbEndpoint ?? env.S3_ENDPOINT ?? null;
  const forcePathStyle = s.s3ForcePathStyle ?? env.S3_FORCE_PATH_STYLE;

  const source: "db" | "env" =
    dbProvider || dbBucket || dbRegion || dbEndpoint || s.s3ForcePathStyle != null
      ? "db"
      : "env";

  // Only non-secret, provider-affecting fields go in the cache key.
  const cacheKey = JSON.stringify({ provider, bucket, region, endpoint, forcePathStyle, encrypt: env.STORAGE_ENCRYPT, localDir: env.LOCAL_STORAGE_DIR });

  return {
    provider,
    encrypt: env.STORAGE_ENCRYPT,
    localDir: env.LOCAL_STORAGE_DIR,
    s3: {
      bucket,
      region,
      endpoint,
      forcePathStyle,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? null,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? null,
    },
    cacheKey,
    source,
  };
}
