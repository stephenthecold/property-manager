-- Vendors (module "vendors"): a directory of contractors/service providers.
-- Reference data only; never a ledger entry. Additive, re-runnable.

DO $$ BEGIN
  CREATE TYPE "VendorTrade" AS ENUM (
    'general', 'plumbing', 'electrical', 'hvac', 'landscaping',
    'cleaning', 'appliance', 'pest_control', 'roofing', 'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Vendor" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "trade"          "VendorTrade" NOT NULL DEFAULT 'general',
  "contactName"    TEXT,
  "email"          TEXT,
  "phone"          TEXT,
  "mailingAddress" TEXT,
  "notes"          TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Vendor_isActive_name_idx" ON "Vendor" ("isActive", "name");
