-- AlterEnum
ALTER TYPE "ReminderStatus" ADD VALUE 'held_for_consent';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "autoRequestSmsConsent" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "smsConsentRequestedAt" TIMESTAMP(3);
