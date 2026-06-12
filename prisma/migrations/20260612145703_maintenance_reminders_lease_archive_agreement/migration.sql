-- AlterEnum
ALTER TYPE "ReminderType" ADD VALUE 'maintenance';

-- AlterEnum
ALTER TYPE "UploadType" ADD VALUE 'lease_template';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "leaseAgreementText" TEXT;

-- AlterTable
ALTER TABLE "Lease" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MaintenanceJob" ADD COLUMN     "notifyDaysBefore" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "notifyTenants" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RecurringTask" ADD COLUMN     "dueDay" INTEGER,
ADD COLUMN     "notifyDaysBefore" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "notifyTenants" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UploadedDocument" ADD COLUMN     "leaseId" TEXT;

-- CreateIndex
CREATE INDEX "UploadedDocument_leaseId_idx" ON "UploadedDocument"("leaseId");
