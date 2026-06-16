-- Workstream E: DB-overridable, NON-SECRET file-storage config (provider + S3
-- bucket/region/endpoint/path-style), mirroring the SMS DB-over-env pattern.
-- All nullable; null -> the env value, so existing deployments are unchanged.
-- Secrets (S3 keys, STORAGE_ENC_KEY), the local dir, and the encrypt flag stay
-- env-only.
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "storageProvider" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "s3Bucket" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "s3Region" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "s3Endpoint" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "s3ForcePathStyle" BOOLEAN;
