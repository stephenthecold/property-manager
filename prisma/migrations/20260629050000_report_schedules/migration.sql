-- Scheduled report delivery. ADDITIVE ONLY: one new ReportSchedule table.
-- Nothing existing is altered or back-filled. The worker's weekly/monthly sweep
-- renders the named report (csv|pdf|xlsx) and emails it to recipientEmails, then
-- stamps lastSentAt. Pure delivery config — never touches the ledger.
--
-- reportType : a report-registry slug (rent-roll, overdue, back-rent, income,
--              lease-expirations, payment-methods).
-- format     : csv | pdf | xlsx.
-- cadence    : weekly | monthly (the "is it due?" math lives in the pure helper
--              lib/reports/schedule.ts; the cadence index keeps the sweep cheap).
-- recipientEmails : comma-separated address list, validated on write.
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "recipientEmails" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_cadence_idx" ON "ReportSchedule"("cadence");
