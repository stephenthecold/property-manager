-- Public marketing site v1: richer, operator-editable content. ADDITIVE ONLY —
-- new nullable AppSettings columns + one UploadType enum value. The hero/gallery
-- photos are UploadedDocument rows (uploadType 'public_site') served publicly
-- via /welcome/photo/[id]; the refs live in these columns.
ALTER TYPE "UploadType" ADD VALUE 'public_site';

ALTER TABLE "AppSettings" ADD COLUMN "publicSiteAmenities" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteHeroDocumentId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteGallery" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AppSettings" ADD COLUMN "publicSiteShowAvailability" BOOLEAN NOT NULL DEFAULT false;
