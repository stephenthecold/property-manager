-- CreateTable
CREATE TABLE "DepositDisposition" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "depositHeldCents" BIGINT NOT NULL,
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "balanceAtFinalizeCents" BIGINT,
    "damagesTotalCents" BIGINT,
    "depositAppliedCents" BIGINT,
    "refundDueCents" BIGINT,
    "balanceOwedCents" BIGINT,
    "damageEntryId" TEXT,
    "depositCreditEntryId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "DepositDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepositDisposition_leaseId_idx" ON "DepositDisposition"("leaseId");

-- CreateIndex
CREATE INDEX "DepositDisposition_status_idx" ON "DepositDisposition"("status");

-- AddForeignKey
ALTER TABLE "DepositDisposition" ADD CONSTRAINT "DepositDisposition_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
