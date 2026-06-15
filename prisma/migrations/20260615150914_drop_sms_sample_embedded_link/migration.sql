-- The 10DLC "sample embedded link" is no longer stored: it is a prefilled,
-- read-only sample derived from APP_URL (lib/config/compliance.ts). Drop the
-- now-unused column added by 20260615135818_compliance_links.
ALTER TABLE "AppSettings" DROP COLUMN IF EXISTS "smsSampleEmbeddedLink";
