-- Compliant SMS opt-in workflow: an append-only consent-event audit log and an
-- optional smsConsent flag captured on rental applications. Additive.
ALTER TABLE "RentalApplication" ADD COLUMN IF NOT EXISTS "smsConsent" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "SmsConsentRecord" (
  "id"             TEXT NOT NULL,
  "phone"          TEXT NOT NULL,
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
  CONSTRAINT "SmsConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SmsConsentRecord_phone_createdAt_idx" ON "SmsConsentRecord" ("phone", "createdAt");
CREATE INDEX IF NOT EXISTS "SmsConsentRecord_tenantId_idx" ON "SmsConsentRecord" ("tenantId");
CREATE INDEX IF NOT EXISTS "SmsConsentRecord_consent_idx" ON "SmsConsentRecord" ("consent");
