-- CreateTable
CREATE TABLE "LeaseRenewalOffer" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "renewalModel" TEXT NOT NULL DEFAULT 'extend',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "proposedRentAmountCents" BIGINT NOT NULL,
    "proposedEndDate" TIMESTAMP(3) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "signingRequestId" TEXT,
    "successorLeaseId" TEXT,
    "declineReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),

    CONSTRAINT "LeaseRenewalOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaseRenewalOffer_leaseId_idx" ON "LeaseRenewalOffer"("leaseId");

-- CreateIndex
CREATE INDEX "LeaseRenewalOffer_status_idx" ON "LeaseRenewalOffer"("status");

-- CreateIndex
CREATE INDEX "LeaseRenewalOffer_signingRequestId_idx" ON "LeaseRenewalOffer"("signingRequestId");

-- AddForeignKey
ALTER TABLE "LeaseRenewalOffer" ADD CONSTRAINT "LeaseRenewalOffer_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
