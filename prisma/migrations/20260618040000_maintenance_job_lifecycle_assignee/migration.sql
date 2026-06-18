-- Work-order lifecycle (Initiative G): richer statuses + a staff assignee.
-- Additive only — existing pending/completed rows and the costCents ->
-- PropertyExpense mirroring are untouched.

-- AlterEnum: add the new lifecycle states (idempotent; safe to re-run).
ALTER TYPE "MaintenanceJobStatus" ADD VALUE IF NOT EXISTS 'assigned';
ALTER TYPE "MaintenanceJobStatus" ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE "MaintenanceJobStatus" ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE "MaintenanceJobStatus" ADD VALUE IF NOT EXISTS 'canceled';

-- AlterTable: loose ref to a staff User (no FK — kept additive).
ALTER TABLE "MaintenanceJob" ADD COLUMN IF NOT EXISTS "assignedToUserId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaintenanceJob_assignedToUserId_idx" ON "MaintenanceJob"("assignedToUserId");
