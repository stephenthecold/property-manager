-- Asset / equipment registry (module "maintenance"): physical equipment
-- (water heaters, HVAC, appliances) tracked per property/unit with warranty
-- awareness. An operating record only — never a ledger entry, never touches
-- tenant balances. Additive, re-runnable.

CREATE TABLE IF NOT EXISTS "Asset" (
  "id"                TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "category"          TEXT,
  "propertyId"        TEXT NOT NULL,
  "unitId"            TEXT,
  "make"              TEXT,
  "model"             TEXT,
  "serialNumber"      TEXT,
  "installedOn"       TIMESTAMP(3),
  "warrantyExpiresOn" TIMESTAMP(3),
  "notes"             TEXT,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "createdBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Asset_propertyId_idx" ON "Asset" ("propertyId");
CREATE INDEX IF NOT EXISTS "Asset_unitId_idx" ON "Asset" ("unitId");

DO $$ BEGIN
  ALTER TABLE "Asset" ADD CONSTRAINT "Asset_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Asset" ADD CONSTRAINT "Asset_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
