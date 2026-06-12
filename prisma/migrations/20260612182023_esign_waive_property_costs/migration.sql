-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "landlordSignatureImageKey" TEXT,
ADD COLUMN     "landlordSignatureName" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "yearlyInsuranceCents" BIGINT,
ADD COLUMN     "yearlyPropertyTaxCents" BIGINT;

-- CreateTable
CREATE TABLE "SigningRequest" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'lease',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "documentText" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "landlordName" TEXT,
    "landlordSignatureKey" TEXT,
    "landlordSignedAt" TIMESTAMP(3),
    "signedDocumentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SigningRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningSigner" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "tokenHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "signatureKind" TEXT,
    "signatureText" TEXT,
    "signatureImageKey" TEXT,
    "consentAt" TIMESTAMP(3),
    "signerIp" TEXT,
    "signerUserAgent" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SigningSigner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SigningRequest_leaseId_idx" ON "SigningRequest"("leaseId");

-- CreateIndex
CREATE INDEX "SigningRequest_status_idx" ON "SigningRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SigningSigner_tokenHash_key" ON "SigningSigner"("tokenHash");

-- CreateIndex
CREATE INDEX "SigningSigner_requestId_idx" ON "SigningSigner"("requestId");

-- CreateIndex
CREATE INDEX "SigningSigner_tenantId_idx" ON "SigningSigner"("tenantId");

-- AddForeignKey
ALTER TABLE "SigningSigner" ADD CONSTRAINT "SigningSigner_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SigningRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
