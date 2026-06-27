-- Turnover / make-ready checklists + Asset<->Job link.
-- Operating records only — none of these tables touch the ledger or tenant
-- balances. Mirrors the maintenance lifecycle (enum-backed status) and the
-- existing additive-column FK style (vendorId on MaintenanceJob).

-- CreateEnum
CREATE TYPE "TurnoverChecklistStatus" AS ENUM ('open', 'in_progress', 'ready');

-- AlterTable: optional Asset link on a maintenance job (clears on asset delete).
ALTER TABLE "MaintenanceJob" ADD COLUMN     "assetId" TEXT;

-- CreateTable
CREATE TABLE "TurnoverChecklist" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "leaseId" TEXT,
    "status" "TurnoverChecklistStatus" NOT NULL DEFAULT 'open',
    "title" TEXT,
    "notes" TEXT,
    "startedOn" TIMESTAMP(3),
    "readyOn" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurnoverChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnoverChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "area" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "assignedToUserId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurnoverChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceJob_assetId_idx" ON "MaintenanceJob"("assetId");

-- CreateIndex
CREATE INDEX "TurnoverChecklist_unitId_status_idx" ON "TurnoverChecklist"("unitId", "status");

-- CreateIndex
CREATE INDEX "TurnoverChecklist_leaseId_idx" ON "TurnoverChecklist"("leaseId");

-- CreateIndex
CREATE INDEX "TurnoverChecklistItem_checklistId_orderIndex_idx" ON "TurnoverChecklistItem"("checklistId", "orderIndex");

-- CreateIndex
CREATE INDEX "TurnoverChecklistItem_assignedToUserId_idx" ON "TurnoverChecklistItem"("assignedToUserId");

-- AddForeignKey
ALTER TABLE "MaintenanceJob" ADD CONSTRAINT "MaintenanceJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoverChecklist" ADD CONSTRAINT "TurnoverChecklist_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoverChecklist" ADD CONSTRAINT "TurnoverChecklist_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoverChecklistItem" ADD CONSTRAINT "TurnoverChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "TurnoverChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
