-- Unit condition photos (module "inspections"). ADDITIVE ONLY: a new enum + a
-- new UnitConditionLog table, one nullable loose-ref column on UploadedDocument,
-- and one new UploadType value. Photos are UploadedDocument rows
-- (unitConditionLogId, uploadType 'condition_photo'). Nothing existing is
-- altered; the Inspection / deposit-disposition flow is untouched.

ALTER TYPE "UploadType" ADD VALUE 'condition_photo';

CREATE TYPE "UnitConditionPhase" AS ENUM ('move_in', 'move_out', 'turnover', 'other');

ALTER TABLE "UploadedDocument" ADD COLUMN "unitConditionLogId" TEXT;
CREATE INDEX "UploadedDocument_unitConditionLogId_idx" ON "UploadedDocument"("unitConditionLogId");

CREATE TABLE "UnitConditionLog" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "leaseId" TEXT,
    "phase" "UnitConditionPhase" NOT NULL,
    "conditionDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnitConditionLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UnitConditionLog_unitId_conditionDate_idx" ON "UnitConditionLog"("unitId", "conditionDate");
CREATE INDEX "UnitConditionLog_leaseId_idx" ON "UnitConditionLog"("leaseId");
ALTER TABLE "UnitConditionLog" ADD CONSTRAINT "UnitConditionLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitConditionLog" ADD CONSTRAINT "UnitConditionLog_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
