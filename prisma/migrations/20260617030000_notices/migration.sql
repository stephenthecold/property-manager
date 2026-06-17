-- Notices (module "notices"): formal landlord notices to a tenant. An operating
-- record (never a ledger entry); subject+body are snapshotted at create.
-- Additive, re-runnable.

DO $$ BEGIN
  CREATE TYPE "NoticeType" AS ENUM ('late_rent', 'lease_violation', 'notice_to_quit', 'non_renewal', 'rent_increase', 'general');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "NoticeStatus" AS ENUM ('draft', 'served', 'void');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Notice" (
  "id"            TEXT NOT NULL,
  "leaseId"       TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "type"          "NoticeType" NOT NULL,
  "status"        "NoticeStatus" NOT NULL DEFAULT 'draft',
  "subject"       TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "effectiveDate" TIMESTAMP(3),
  "servedAt"      TIMESTAMP(3),
  "servedMethod"  TEXT,
  "notes"         TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Notice_leaseId_idx" ON "Notice" ("leaseId");
CREATE INDEX IF NOT EXISTS "Notice_status_idx" ON "Notice" ("status");

DO $$ BEGIN
  ALTER TABLE "Notice" ADD CONSTRAINT "Notice_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
