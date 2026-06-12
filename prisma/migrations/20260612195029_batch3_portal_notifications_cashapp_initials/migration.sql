-- CreateEnum
CREATE TYPE "TenantRequestType" AS ENUM ('maintenance', 'cash_pickup');

-- CreateEnum
CREATE TYPE "TenantRequestStatus" AS ENUM ('open', 'in_progress', 'done', 'declined');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'cash_app';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "cashAppCashtag" TEXT,
ADD COLUMN     "landlordInitialsImageKey" TEXT;

-- AlterTable
ALTER TABLE "SigningRequest" ADD COLUMN     "landlordInitialsKey" TEXT;

-- AlterTable
ALTER TABLE "SigningSigner" ADD COLUMN     "initialsImageKey" TEXT,
ADD COLUMN     "initialsKind" TEXT,
ADD COLUMN     "initialsText" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "preferredPaymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyCashPickup" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyMaintenanceDigest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyOverdueDigest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "TenantPortalAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "otpLastSentAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPortalSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantPortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaseId" TEXT,
    "type" "TenantRequestType" NOT NULL,
    "message" TEXT,
    "status" "TenantRequestStatus" NOT NULL DEFAULT 'open',
    "maintenanceJobId" TEXT,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPortalAccount_tenantId_key" ON "TenantPortalAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPortalAccount_email_key" ON "TenantPortalAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPortalAccount_phone_key" ON "TenantPortalAccount"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPortalAccount_inviteTokenHash_key" ON "TenantPortalAccount"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPortalSession_tokenHash_key" ON "TenantPortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "TenantPortalSession_accountId_idx" ON "TenantPortalSession"("accountId");

-- CreateIndex
CREATE INDEX "TenantPortalSession_expiresAt_idx" ON "TenantPortalSession"("expiresAt");

-- CreateIndex
CREATE INDEX "TenantRequest_status_createdAt_idx" ON "TenantRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TenantRequest_tenantId_idx" ON "TenantRequest"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantPortalAccount" ADD CONSTRAINT "TenantPortalAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPortalSession" ADD CONSTRAINT "TenantPortalSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TenantPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantRequest" ADD CONSTRAINT "TenantRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
