import { access, constants, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/config/env";
import { resolveStorageConfig } from "@/lib/services/storage-config";

/**
 * Best-effort persistence probe for containerized installs: true when `dir`
 * sits on a dedicated mount (volume / bind / network share), false when it is
 * on the container's root filesystem — i.e. the writable overlay layer that is
 * DESTROYED on rebuild — and null outside containers or when undeterminable.
 */
async function isOnDedicatedMount(dir: string): Promise<boolean | null> {
  try {
    await access("/.dockerenv");
  } catch {
    return null; // not in a Docker container (e.g. bare-metal dev) — no signal
  }
  try {
    const mounts = await readFile("/proc/self/mounts", "utf8");
    const points = mounts
      .split("\n")
      .map((line) => line.split(" ")[1])
      .filter((p): p is string => !!p && p !== "/");
    return points.some((p) => dir === p || dir.startsWith(`${p}/`));
  } catch {
    return null;
  }
}

/**
 * Read-only view of the effective file-storage configuration for the Settings
 * UI. Secrets are NEVER returned — only whether each is set. The provider and
 * its parameters come from environment variables (see .env.example); this
 * surfaces them so an operator can confirm setup without shell access.
 */
export interface StorageStatus {
  provider: "stub" | "s3" | "local";
  /** True when the provider has everything it needs to store/serve files. */
  ready: boolean;
  health: { level: "ok" | "warn" | "error"; message: string };
  /** Non-secret config rows to display (label/value pairs). */
  fields: { label: string; value: string }[];
  /** Presence-only flags for secrets (true = set, never the value). */
  secrets: { label: string; set: boolean }[];
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const env = getEnv();
  // Effective config = NON-SECRET DB overrides merged over env (secrets, local
  // dir, and the encrypt flag stay env-only).
  const cfg = await resolveStorageConfig();
  const provider = cfg.provider;

  if (provider === "stub") {
    return {
      provider,
      ready: false,
      health: {
        level: "warn",
        message:
          "Uploads are disabled (STORAGE_PROVIDER=stub). Set it to s3 or local to enable documents and receipts.",
      },
      fields: [{ label: "Provider", value: "Stub (uploads disabled)" }],
      secrets: [],
    };
  }

  if (provider === "local") {
    const dir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
    let writable = false;
    let detail = "";
    try {
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
      writable = true;
    } catch (e) {
      detail = e instanceof Error ? e.message : "directory not writable";
    }
    const encryptOn = env.STORAGE_ENCRYPT;
    const keyOk = !!(env.STORAGE_ENC_KEY || env.SETTINGS_ENC_KEY);
    const onMount = await isOnDedicatedMount(dir);
    return {
      provider,
      ready: writable && (!encryptOn || keyOk),
      health: !writable
        ? { level: "error", message: `Storage directory is not writable: ${detail}` }
        : encryptOn && !keyOk
          ? {
              level: "error",
              message:
                "Encryption is on but no key is available — set STORAGE_ENC_KEY or SETTINGS_ENC_KEY.",
            }
          : onMount === false
            ? {
                level: "warn",
                message:
                  "Uploads work, but the storage directory is inside the container's writable layer — files will be LOST when the container is rebuilt. Mount a volume at this path (compose mounts uploads:/data/uploads) or point LOCAL_STORAGE_DIR at a mounted share.",
              }
            : {
                level: "ok",
                message: encryptOn
                  ? "Local/share storage is writable; new files are encrypted at rest (AES-256-GCM)."
                  : "Local storage directory is writable. Files are stored unencrypted — set STORAGE_ENCRYPT=true to encrypt at rest (recommended for network shares).",
              },
      fields: [
        { label: "Provider", value: "Local disk / mounted share" },
        { label: "Directory", value: dir },
        {
          label: "Persistence",
          value:
            onMount === true
              ? "Volume / mounted share"
              : onMount === false
                ? "Container layer — NOT persistent"
                : "Host disk",
        },
        {
          label: "Encryption at rest",
          value: encryptOn
            ? `On — AES-256-GCM (${env.STORAGE_ENC_KEY ? "STORAGE_ENC_KEY" : "key derived from SETTINGS_ENC_KEY"})`
            : "Off",
        },
      ],
      secrets: [],
    };
  }

  // s3 (also R2 / B2 / MinIO via endpoint + path-style). Bucket/region/endpoint/
  // path-style come from the DB-over-env resolve; keys stay env-only secrets.
  const hasKey = !!cfg.s3.accessKeyId;
  const hasSecret = !!cfg.s3.secretAccessKey;
  const complete = !!cfg.s3.bucket && hasKey && hasSecret;
  const missing: string[] = [];
  if (!cfg.s3.bucket) missing.push("bucket");
  if (!hasKey) missing.push("S3_ACCESS_KEY_ID");
  if (!hasSecret) missing.push("S3_SECRET_ACCESS_KEY");

  return {
    provider,
    ready: complete,
    health: complete
      ? { level: "ok", message: `S3 storage is configured (config from ${cfg.source === "db" ? "Settings" : "environment"}).` }
      : { level: "error", message: `Incomplete S3 configuration — missing: ${missing.join(", ")}.` },
    fields: [
      { label: "Provider", value: "S3-compatible" },
      { label: "Config source", value: cfg.source === "db" ? "Settings (DB over env)" : "Environment" },
      { label: "Bucket", value: cfg.s3.bucket || "— (not set)" },
      { label: "Region", value: cfg.s3.region || "us-east-1 (default)" },
      { label: "Endpoint", value: cfg.s3.endpoint || "AWS default" },
      { label: "Path-style addressing", value: cfg.s3.forcePathStyle ? "on" : "off" },
    ],
    secrets: [
      { label: "Access key ID", set: hasKey },
      { label: "Secret access key", set: hasSecret },
    ],
  };
}
