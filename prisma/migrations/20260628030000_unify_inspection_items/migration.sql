-- Unify the two inspection-item concepts into one. The condition checklist item
-- now also carries the optional deposit-deduction amount, so a single move-out
-- walkthrough item captures condition + photos + (if it fails) a deduction. The
-- move-out deposit disposition sums these amounts. The separate deduction-only
-- InspectionItem table is removed.
--
-- This is a destructive drop, done deliberately while the table holds no data
-- worth keeping (pre-launch / fresh DB). Forward-only, like every migration.
ALTER TABLE "InspectionChecklistItem" ADD COLUMN "amountCents" BIGINT NOT NULL DEFAULT 0;

DROP TABLE "InspectionItem";
