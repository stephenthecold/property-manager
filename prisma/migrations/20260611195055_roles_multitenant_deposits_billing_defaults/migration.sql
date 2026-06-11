-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'finance';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "defaultDueDay" INTEGER,
ADD COLUMN     "defaultGraceDays" INTEGER,
ADD COLUMN     "defaultInternetFeeCents" BIGINT,
ADD COLUMN     "defaultLateFeeAmountCents" BIGINT,
ADD COLUMN     "defaultLateFeeBps" INTEGER,
ADD COLUMN     "defaultLateFeeType" "LateFeeType";

-- AlterTable
ALTER TABLE "Lease" ADD COLUMN     "billingStartDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeaseTenant" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseDeposit" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "nonRefundableCents" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaseTenant_tenantId_idx" ON "LeaseTenant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseTenant_leaseId_tenantId_key" ON "LeaseTenant"("leaseId", "tenantId");

-- CreateIndex
CREATE INDEX "LeaseDeposit_leaseId_idx" ON "LeaseDeposit"("leaseId");

-- AddForeignKey
ALTER TABLE "LeaseTenant" ADD CONSTRAINT "LeaseTenant_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseTenant" ADD CONSTRAINT "LeaseTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseDeposit" ADD CONSTRAINT "LeaseDeposit_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Scheduled-reminder idempotency becomes PER TENANT so each consenting
-- co-tenant on a lease gets their own reminder per (type, period). Partial
-- predicate cannot be expressed by @@unique, hence raw SQL (same convention
-- as 20260609182200_constraints).
DROP INDEX "Reminder_lease_type_period_unique";
CREATE UNIQUE INDEX "Reminder_lease_tenant_type_period_unique"
  ON "Reminder" ("leaseId", "tenantId", "reminderType", "periodKey")
  WHERE "periodKey" IS NOT NULL;
