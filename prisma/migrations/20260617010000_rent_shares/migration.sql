-- Rent split / subsidy expectations (B2). A RentShare line says "this much of
-- the monthly rent is expected from this party" (payerId null = the tenant's
-- portion). EXPECTATION overlay only — never posts ledger entries or affects
-- balances/allocation. Effective-dated so a recertification supersedes prior
-- splits (set endDate on the old rows). Additive, re-runnable.

CREATE TABLE IF NOT EXISTS "RentShare" (
  "id"            TEXT NOT NULL,
  "leaseId"       TEXT NOT NULL,
  "payerId"       TEXT,
  "label"         TEXT NOT NULL,
  "amountCents"   BIGINT NOT NULL,
  "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate"       TIMESTAMP(3),
  "notes"         TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RentShare_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RentShare_leaseId_effectiveDate_idx" ON "RentShare" ("leaseId", "effectiveDate");
CREATE INDEX IF NOT EXISTS "RentShare_payerId_idx" ON "RentShare" ("payerId");

DO $$ BEGIN
  ALTER TABLE "RentShare" ADD CONSTRAINT "RentShare_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RentShare" ADD CONSTRAINT "RentShare_payerId_fkey"
    FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
