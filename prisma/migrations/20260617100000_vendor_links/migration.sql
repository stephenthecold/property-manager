-- Link vendors to maintenance jobs and property expenses (attribution).
-- Additive + nullable: existing rows get vendorId = NULL. FK is SET NULL on
-- delete (vendors are normally deactivated, not deleted, but this is safe).

ALTER TABLE "MaintenanceJob" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;
ALTER TABLE "PropertyExpense" ADD COLUMN IF NOT EXISTS "vendorId" TEXT;

CREATE INDEX IF NOT EXISTS "MaintenanceJob_vendorId_idx" ON "MaintenanceJob" ("vendorId");
CREATE INDEX IF NOT EXISTS "PropertyExpense_vendorId_idx" ON "PropertyExpense" ("vendorId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'MaintenanceJob_vendorId_fkey'
  ) THEN
    ALTER TABLE "MaintenanceJob"
      ADD CONSTRAINT "MaintenanceJob_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PropertyExpense_vendorId_fkey'
  ) THEN
    ALTER TABLE "PropertyExpense"
      ADD CONSTRAINT "PropertyExpense_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
