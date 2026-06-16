-- Operator-configurable customization (Settings → Organization): receipt number
-- prefix and tenant-facing portal/apply copy. All nullable; null falls back to
-- the shipped defaults at read time.
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "receiptPrefix" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "portalWelcomeText" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "applyIntroText" TEXT;
