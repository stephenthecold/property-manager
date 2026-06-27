-- Inspection TEMPLATES (reusable ordered checklists), per-inspection CHECKLIST
-- items (with pass/fail/na status + notes + photos), and the link from
-- UploadedDocument to a checklist item. All operating records — they never touch
-- the ledger or deposit disposition. The existing InspectionItem (money
-- deduction) model is untouched.

-- CreateEnum
CREATE TYPE "InspectionChecklistStatus" AS ENUM ('pending', 'pass', 'fail', 'na');

-- AlterEnum
ALTER TYPE "UploadType" ADD VALUE 'inspection_photo';

-- CreateTable
CREATE TABLE "InspectionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InspectionType",
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "area" TEXT,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionChecklistItem" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "area" TEXT,
    "category" TEXT,
    "status" "InspectionChecklistStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionChecklistItem_pkey" PRIMARY KEY ("id")
);

-- AlterTable: link an inspection to the template it was created from (nullable)
ALTER TABLE "Inspection" ADD COLUMN "templateId" TEXT;

-- AlterTable: link an uploaded photo to a single inspection checklist item
ALTER TABLE "UploadedDocument" ADD COLUMN "inspectionChecklistItemId" TEXT;

-- CreateIndex
CREATE INDEX "InspectionTemplate_isActive_idx" ON "InspectionTemplate"("isActive");

-- CreateIndex
CREATE INDEX "InspectionTemplateItem_templateId_idx" ON "InspectionTemplateItem"("templateId");

-- CreateIndex
CREATE INDEX "InspectionChecklistItem_inspectionId_idx" ON "InspectionChecklistItem"("inspectionId");

-- CreateIndex
CREATE INDEX "Inspection_templateId_idx" ON "Inspection"("templateId");

-- CreateIndex
CREATE INDEX "UploadedDocument_inspectionChecklistItemId_idx" ON "UploadedDocument"("inspectionChecklistItemId");

-- AddForeignKey
ALTER TABLE "InspectionTemplateItem" ADD CONSTRAINT "InspectionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionChecklistItem" ADD CONSTRAINT "InspectionChecklistItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: deleting a template leaves its inspections intact (SetNull)
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InspectionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
