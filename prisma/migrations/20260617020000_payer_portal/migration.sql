-- Payer portal: a separate LOCAL auth lane so a third-party payer (e.g. a
-- housing authority) can sign in to a read-only view of the leases they pay.
-- Email + password via an invite link; opaque session tokens stored as sha-256
-- hashes. Additive, re-runnable.

CREATE TABLE IF NOT EXISTS "PayerPortalAccount" (
  "id"              TEXT NOT NULL,
  "payerId"         TEXT NOT NULL,
  "email"           TEXT,
  "passwordHash"    TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "inviteTokenHash" TEXT,
  "inviteExpiresAt" TIMESTAMP(3),
  "failedLogins"    INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"     TIMESTAMP(3),
  "lastLoginAt"     TIMESTAMP(3),
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayerPortalAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayerPortalAccount_payerId_key" ON "PayerPortalAccount" ("payerId");
CREATE UNIQUE INDEX IF NOT EXISTS "PayerPortalAccount_email_key" ON "PayerPortalAccount" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "PayerPortalAccount_inviteTokenHash_key" ON "PayerPortalAccount" ("inviteTokenHash");

CREATE TABLE IF NOT EXISTS "PayerPortalSession" (
  "id"        TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayerPortalSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayerPortalSession_tokenHash_key" ON "PayerPortalSession" ("tokenHash");
CREATE INDEX IF NOT EXISTS "PayerPortalSession_accountId_idx" ON "PayerPortalSession" ("accountId");
CREATE INDEX IF NOT EXISTS "PayerPortalSession_expiresAt_idx" ON "PayerPortalSession" ("expiresAt");

DO $$ BEGIN
  ALTER TABLE "PayerPortalAccount" ADD CONSTRAINT "PayerPortalAccount_payerId_fkey"
    FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PayerPortalSession" ADD CONSTRAINT "PayerPortalSession_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "PayerPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
