-- CreateIndex
CREATE INDEX "LedgerEntry_leaseId_entryType_idx" ON "LedgerEntry"("leaseId", "entryType");

-- CreateIndex
CREATE INDEX "Payment_status_paymentDate_idx" ON "Payment"("status", "paymentDate");
