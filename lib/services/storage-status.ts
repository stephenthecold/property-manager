import { access, constants, mkdir } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/config/env";

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
  const provider = env.STORAGE_PROVIDER;

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
          label: "Encryption at rest",
          value: encryptOn
            ? `On — AES-256-GCM (${env.STORAGE_ENC_KEY ? "STORAGE_ENC_KEY" : "key derived from SETTINGS_ENC_KEY"})`
            : "Off",
        },
      ],
      secrets: [],
    };
  }

  // s3 (also R2 / B2 / MinIO via endpoint + path-style)
  const hasKey = !!env.S3_ACCESS_KEY_ID;
  const hasSecret = !!env.S3_SECRET_ACCESS_KEY;
  const complete = !!env.S3_BUCKET && hasKey && hasSecret;
  const missing: string[] = [];
  if (!env.S3_BUCKET) missing.push("S3_BUCKET");
  if (!hasKey) missing.push("S3_ACCESS_KEY_ID");
  if (!hasSecret) missing.push("S3_SECRET_ACCESS_KEY");

  return {
    provider,
    ready: complete,
    health: complete
      ? { level: "ok", message: "S3 storage is configured." }
      : { level: "error", message: `Incomplete S3 configuration — missing: ${missing.join(", ")}.` },
    fields: [
      { label: "Provider", value: "S3-compatible" },
      { label: "Bucket", value: env.S3_BUCKET || "— (not set)" },
      { label: "Region", value: env.S3_REGION || "us-east-1 (default)" },
      { label: "Endpoint", value: env.S3_ENDPOINT || "AWS default" },
      { label: "Path-style addressing", value: env.S3_FORCE_PATH_STYLE ? "on" : "off" },
    ],
    secrets: [
      { label: "Access key ID", set: hasKey },
      { label: "Secret access key", set: hasSecret },
    ],
  };
}
