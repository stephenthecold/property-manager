-- Inspections (module "inspections"): scheduled/recorded property-condition
-- inspections + itemized deposit-disposition deductions. Operating records
-- (never ledger entries). Additive, re-runnable.

DO $$ BEGIN
  CREATE TYPE "InspectionType" AS ENUM ('move_in', 'move_out', 'routine', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "InspectionStatus" AS ENUM ('scheduled', 'completed', 'canceled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Inspection" (
  "id"           TEXT NOT NULL,
  "leaseId"      TEXT NOT NULL,
  "type"         "InspectionType" NOT NULL,
  "status"       "InspectionStatus" NOT NULL DEFAULT 'scheduled',
  "scheduledFor" TIMESTAMP(3),
  "completedAt"  TIMESTAMP(3),
  "inspector"    TEXT,
  "summary"      TEXT,
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Inspection_leaseId_idx" ON "Inspection" ("leaseId");
CREATE INDEX IF NOT EXISTS "Inspection_status_idx" ON "Inspection" ("status");

CREATE TABLE IF NOT EXISTS "InspectionItem" (
  "id"           TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "amountCents"  BIGINT NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InspectionItem_inspectionId_idx" ON "InspectionItem" ("inspectionId");

DO $$ BEGIN
  ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "InspectionItem" ADD CONSTRAINT "InspectionItem_inspectionId_fkey"
    FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
