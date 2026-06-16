-- Workstream C: email as a reminder channel alongside SMS. Consent is absolute
-- and per-channel; a tenant has one preferred channel, so the existing
-- (leaseId, tenantId, reminderType, periodKey) idempotency slot is unchanged —
-- `channel` is just an attribute of the one row.

-- New enum for the delivery channel.
DO $$ BEGIN
  CREATE TYPE "NotificationChannel" AS ENUM ('sms', 'email');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Per-tenant email consent + preferred reminder channel.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "emailConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "reminderChannel" "NotificationChannel" NOT NULL DEFAULT 'sms';

-- Channel + email destination on the reminder log.
ALTER TABLE "Reminder" ADD COLUMN IF NOT EXISTS "channel" "NotificationChannel" NOT NULL DEFAULT 'sms';
ALTER TABLE "Reminder" ADD COLUMN IF NOT EXISTS "destinationEmail" TEXT;
