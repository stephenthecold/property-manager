-- Consent history consolidation: SmsConsentRecord → ConsentRecord, now covering
-- BOTH SMS and email. Renames the table (preserving existing SMS rows), adds a
-- `channel` column (existing rows = sms), makes `phone` nullable (email rows
-- carry no phone), and adds an email lookup index. Data-preserving + re-runnable.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'SmsConsentRecord')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ConsentRecord')
  THEN
    ALTER TABLE "SmsConsentRecord" RENAME TO "ConsentRecord";
    ALTER TABLE "ConsentRecord" RENAME CONSTRAINT "SmsConsentRecord_pkey" TO "ConsentRecord_pkey";
    ALTER INDEX IF EXISTS "SmsConsentRecord_phone_createdAt_idx" RENAME TO "ConsentRecord_phone_createdAt_idx";
    ALTER INDEX IF EXISTS "SmsConsentRecord_tenantId_idx" RENAME TO "ConsentRecord_tenantId_idx";
    -- The old index was on (consent) only; the new schema indexes (channel, consent).
    DROP INDEX IF EXISTS "SmsConsentRecord_consent_idx";
  END IF;
END $$;

-- Create the table fresh if neither name exists (clean installs run this migration only).
CREATE TABLE IF NOT EXISTS "ConsentRecord" (
  "id"             TEXT NOT NULL,
  "channel"        "NotificationChannel" NOT NULL DEFAULT 'sms',
  "phone"          TEXT,
  "phoneRaw"       TEXT,
  "fullName"       TEXT,
  "email"          TEXT,
  "tenantId"       TEXT,
  "applicationId"  TEXT,
  "propertyUnit"   TEXT,
  "consent"        BOOLEAN NOT NULL,
  "source"         TEXT NOT NULL,
  "consentText"    TEXT,
  "consentVersion" TEXT,
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- Add `channel` to a renamed (pre-existing) table if it lacks it; backfill = sms.
ALTER TABLE "ConsentRecord" ADD COLUMN IF NOT EXISTS "channel" "NotificationChannel" NOT NULL DEFAULT 'sms';

-- Email rows carry no phone — relax the historical NOT NULL.
ALTER TABLE "ConsentRecord" ALTER COLUMN "phone" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "ConsentRecord_phone_createdAt_idx" ON "ConsentRecord" ("phone", "createdAt");
CREATE INDEX IF NOT EXISTS "ConsentRecord_email_createdAt_idx" ON "ConsentRecord" ("email", "createdAt");
CREATE INDEX IF NOT EXISTS "ConsentRecord_tenantId_idx" ON "ConsentRecord" ("tenantId");
CREATE INDEX IF NOT EXISTS "ConsentRecord_channel_consent_idx" ON "ConsentRecord" ("channel", "consent");
