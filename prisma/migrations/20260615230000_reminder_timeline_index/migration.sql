-- Replace the single-column tenantId index with a composite (tenantId, createdAt)
-- that serves both the plain tenantId lookup (leading-column prefix) and the
-- tenant reminder timeline ordered by createdAt.
DROP INDEX IF EXISTS "Reminder_tenantId_idx";
CREATE INDEX IF NOT EXISTS "Reminder_tenantId_createdAt_idx" ON "Reminder" ("tenantId", "createdAt");
