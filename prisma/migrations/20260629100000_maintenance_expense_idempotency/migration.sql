-- Maintenance-job cost mirroring is now idempotent: exactly one PropertyExpense
-- per job. Previously, reopening a completed job left its mirrored expense in
-- place, so re-completing the job stacked a SECOND expense and double-counted
-- the Financials maintenance total. The app now upserts the mirror by
-- (sourceType, sourceId); this migration backfills the same invariant.

-- 1) Collapse any pre-existing duplicate mirrors left by that bug, keeping the
--    most recent row per job (deterministic: newest createdAt, id as tiebreak).
--    These deleted rows are the erroneous double-counts; the surviving row is
--    the job's true mirrored cost.
DELETE FROM "PropertyExpense" a
USING "PropertyExpense" b
WHERE a."sourceType" = 'maintenance_job'
  AND b."sourceType" = 'maintenance_job'
  AND a."sourceId" = b."sourceId"
  AND (
    a."createdAt" < b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" < b."id")
  );

-- 2) Enforce one expense mirror per maintenance job going forward.
CREATE UNIQUE INDEX "PropertyExpense_maintenance_job_source_uniq"
  ON "PropertyExpense" ("sourceType", "sourceId")
  WHERE "sourceType" = 'maintenance_job';
