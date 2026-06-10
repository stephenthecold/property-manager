-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "periodKey" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_paymentId_idx" ON "Receipt"("paymentId");

-- CreateIndex
CREATE INDEX "Receipt_tenantId_idx" ON "Receipt"("tenantId");

-- CreateIndex
CREATE INDEX "Reminder_leaseId_idx" ON "Reminder"("leaseId");

-- CreateIndex
CREATE INDEX "Reminder_providerMessageId_idx" ON "Reminder"("providerMessageId");

-- CreateIndex
CREATE INDEX "UploadedDocument_tenantId_idx" ON "UploadedDocument"("tenantId");

-- CreateIndex
CREATE INDEX "UploadedDocument_paymentId_idx" ON "UploadedDocument"("paymentId");

-- CreateIndex
CREATE INDEX "UploadedDocument_receiptId_idx" ON "UploadedDocument"("receiptId");

-- Idempotency for digital receipt generation: at most one digital receipt per payment.
-- Partial predicate cannot be expressed by @@unique, hence raw SQL (same convention as
-- 20260609182200_constraints).
CREATE UNIQUE INDEX "Receipt_digital_payment_unique"
  ON "Receipt" ("paymentId")
  WHERE "receiptType" = 'digital' AND "paymentId" IS NOT NULL;

-- Idempotency for scheduled reminders: one reminder per (lease, type, period).
-- Worker re-runs insert-and-catch-P2002 exactly like rent charges / late fees.
CREATE UNIQUE INDEX "Reminder_lease_type_period_unique"
  ON "Reminder" ("leaseId", "reminderType", "periodKey")
  WHERE "periodKey" IS NOT NULL;
