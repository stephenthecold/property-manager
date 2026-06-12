import { z } from "zod";

/**
 * Centralized, fail-fast environment configuration.
 *
 * Validation is lazy (first call to {@link getEnv}) so that `next build` and
 * tooling that only imports modules without executing request paths do not
 * crash on missing runtime secrets. Always call `getEnv()` inside functions,
 * not at module top-level, so importing a module never forces validation.
 */

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === "true" || v === "1" || v === "yes");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Core
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().min(1).default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_TRUST_HOST: boolish.default(false),

  // AES-256-GCM key-encryption-key for OIDC client secret at rest.
  // Expected: 32 bytes encoded as base64 or hex. Optional until OIDC is configured via DB.
  SETTINGS_ENC_KEY: z.string().min(1).optional(),

  // Installer / first-run setup
  SETUP_BOOTSTRAP_TOKEN: z.string().min(1).optional(),
  SEED_ON_START: boolish.default(false),

  // OIDC (Authentik) env fallback — DB AuthSettings takes precedence when enabled.
  AUTHENTIK_ISSUER: z.string().optional(),
  AUTHENTIK_CLIENT_ID: z.string().optional(),
  AUTHENTIK_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().default("openid email profile"),
  ALLOW_OWNER_FROM_GROUP: boolish.default(false),

  // Break-glass emergency access (off by default).
  BREAK_GLASS: boolish.default(false),

  // Reverse-proxy: how many trusted proxy hops sit in front (for real client IP).
  TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).default(1),

  // File storage provider (stub default → nothing external required in Phase 1).
  // "local" stores files on the app server's disk (single-node, dev/small installs).
  STORAGE_PROVIDER: z.enum(["stub", "s3", "local"]).default("stub"),
  LOCAL_STORAGE_DIR: z.string().default(".data/uploads"),
  // Encrypt files at rest (local provider only — e.g. when LOCAL_STORAGE_DIR is
  // a mounted network share). Key: STORAGE_ENC_KEY (32 bytes, base64/hex) or,
  // when unset, a subkey derived from SETTINGS_ENC_KEY via HKDF.
  STORAGE_ENCRYPT: boolish.default(false),
  STORAGE_ENC_KEY: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish.default(true),

  // SMS provider (stub default).
  SMS_PROVIDER: z.enum(["stub", "twilio", "telnyx"]).default("stub"),
  // How many days before the due date the scheduled "rent due soon" reminder fires.
  REMINDER_DUE_SOON_DAYS: z.coerce.number().int().min(0).default(3),
  SMS_ACCOUNT_SID: z.string().optional(),
  SMS_AUTH_TOKEN: z.string().optional(),
  SMS_FROM_NUMBER: z.string().optional(),

  // OCR (Phase 5).
  OCR_ENABLED: boolish.default(false),
  OCR_PROVIDER: z.string().optional(),

  // Defaults applied when creating new properties.
  DEFAULT_TIMEZONE: z.string().default("America/New_York"),
  DEFAULT_CURRENCY: z.string().default("USD"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: clear the memoized env so a new process.env can be re-read. */
export function resetEnvCache(): void {
  cached = null;
}
