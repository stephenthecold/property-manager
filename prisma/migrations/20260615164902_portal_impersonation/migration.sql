-- AlterTable
ALTER TABLE "TenantPortalSession" ADD COLUMN     "impersonatedByUserId" TEXT;

-- CreateTable
CREATE TABLE "TenantPortalTrialToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantPortalTrialToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPortalTrialToken_tokenHash_key" ON "TenantPortalTrialToken"("tokenHash");

-- CreateIndex
CREATE INDEX "TenantPortalTrialToken_tenantId_idx" ON "TenantPortalTrialToken"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantPortalTrialToken" ADD CONSTRAINT "TenantPortalTrialToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
