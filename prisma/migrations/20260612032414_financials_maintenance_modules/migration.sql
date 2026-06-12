-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('utilities', 'insurance', 'maintenance', 'taxes', 'other');

-- CreateEnum
CREATE TYPE "MaintenanceJobStatus" AS ENUM ('pending', 'completed');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "modules" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "monthlyMortgageCents" BIGINT,
ADD COLUMN     "mortgageMaturityDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PropertyExpense" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT,
    "leaseId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceJob" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "status" "MaintenanceJobStatus" NOT NULL DEFAULT 'pending',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "costCents" BIGINT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTask" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastDoneOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyExpense_propertyId_incurredOn_idx" ON "PropertyExpense"("propertyId", "incurredOn");

-- CreateIndex
CREATE INDEX "PropertyExpense_unitId_idx" ON "PropertyExpense"("unitId");

-- CreateIndex
CREATE INDEX "PropertyExpense_category_idx" ON "PropertyExpense"("category");

-- CreateIndex
CREATE INDEX "MaintenanceJob_propertyId_status_idx" ON "MaintenanceJob"("propertyId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceJob_unitId_status_idx" ON "MaintenanceJob"("unitId", "status");

-- CreateIndex
CREATE INDEX "RecurringTask_propertyId_active_idx" ON "RecurringTask"("propertyId", "active");

-- AddForeignKey
ALTER TABLE "PropertyExpense" ADD CONSTRAINT "PropertyExpense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyExpense" ADD CONSTRAINT "PropertyExpense_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyExpense" ADD CONSTRAINT "PropertyExpense_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyExpense" ADD CONSTRAINT "PropertyExpense_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceJob" ADD CONSTRAINT "MaintenanceJob_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceJob" ADD CONSTRAINT "MaintenanceJob_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
