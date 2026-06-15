-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "privacyPolicyText" TEXT,
ADD COLUMN     "privacyPolicyUrl" TEXT,
ADD COLUMN     "termsText" TEXT,
ADD COLUMN     "termsUrl" TEXT,
ADD COLUMN     "smsSampleEmbeddedLink" TEXT;
