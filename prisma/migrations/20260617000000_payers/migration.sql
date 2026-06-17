-- Non-tenant payers (HUD / housing authority, employer, guarantor, …): a
-- reusable attribution directory plus an optional Payment.payerId. Additive and
-- ledger-neutral — payer attribution never affects balances or FIFO allocation.

-- PayerType enum (guarded so a re-run is a no-op).
DO $$ BEGIN
  CREATE TYPE "PayerType" AS ENUM ('housing_authority', 'employer', 'guarantor', 'family', 'nonprofit', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "Payer" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "type"           "PayerType" NOT NULL DEFAULT 'housing_authority',
  "contactName"    TEXT,
  "email"          TEXT,
  "phone"          TEXT,
  "mailingAddress" TEXT,
  "notes"          TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Payer_isActive_name_idx" ON "Payer" ("isActive", "name");

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "payerId" TEXT;
CREATE INDEX IF NOT EXISTS "Payment_payerId_idx" ON "Payment" ("payerId");

DO $$ BEGIN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerId_fkey"
    FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
