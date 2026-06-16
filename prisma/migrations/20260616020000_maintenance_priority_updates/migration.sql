-- Workstream D: maintenance "tickets" — a triage priority on jobs and a
-- threaded update/progress log. Both additive; priority defaults to 'normal'
-- so existing jobs are unaffected. Updates are append-only and audited.

DO $$ BEGIN
  CREATE TYPE "MaintenancePriority" AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "MaintenanceJob"
  ADD COLUMN IF NOT EXISTS "priority" "MaintenancePriority" NOT NULL DEFAULT 'normal';

CREATE TABLE IF NOT EXISTS "MaintenanceUpdate" (
  "id"        TEXT NOT NULL,
  "jobId"     TEXT NOT NULL,
  "note"      TEXT NOT NULL,
  "newStatus" "MaintenanceJobStatus",
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MaintenanceUpdate_jobId_createdAt_idx"
  ON "MaintenanceUpdate" ("jobId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "MaintenanceUpdate"
    ADD CONSTRAINT "MaintenanceUpdate_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "MaintenanceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
