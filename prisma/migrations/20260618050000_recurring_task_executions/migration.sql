-- Preventive-maintenance per-occurrence execution log (Initiative G). A
-- RecurringTaskExecution records that a monthly task was done FOR a given
-- property-timezone month ("YYYY-MM"). One row per task per month — re-marking
-- the same month upserts the existing row. These are operating records and
-- never touch tenant balances. Additive, re-runnable.

CREATE TABLE IF NOT EXISTS "RecurringTaskExecution" (
  "id"           TEXT NOT NULL,
  "taskId"       TEXT NOT NULL,
  "periodKey"    TEXT NOT NULL,
  "doneOn"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneByUserId" TEXT,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringTaskExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecurringTaskExecution_taskId_periodKey_key"
  ON "RecurringTaskExecution" ("taskId", "periodKey");
CREATE INDEX IF NOT EXISTS "RecurringTaskExecution_taskId_idx"
  ON "RecurringTaskExecution" ("taskId");

DO $$ BEGIN
  ALTER TABLE "RecurringTaskExecution" ADD CONSTRAINT "RecurringTaskExecution_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "RecurringTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
