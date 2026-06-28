-- Per-reminder-type channel override for tenant self-serve notification
-- preferences. The tenant's global Tenant.reminderChannel stays the default;
-- a row here overrides ONE reminder type. `channel` is TEXT (not the
-- NotificationChannel enum) so it can also store "off" (mute this type).
-- Additive only.

-- CreateTable
CREATE TABLE "TenantReminderPref" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantReminderPref_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantReminderPref_tenantId_reminderType_key" ON "TenantReminderPref"("tenantId", "reminderType");

-- CreateIndex
CREATE INDEX "TenantReminderPref_tenantId_idx" ON "TenantReminderPref"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantReminderPref" ADD CONSTRAINT "TenantReminderPref_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
