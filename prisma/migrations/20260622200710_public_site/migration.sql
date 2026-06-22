-- Public marketing site (module "publicSite"): operator-authored splash copy +
-- the public base URL used for tenant-portal invite/reset links. All nullable
-- and additive — no backfill, no data change.
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteUrl" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteTagline" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteIntro" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteAreas" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteHours" TEXT;
