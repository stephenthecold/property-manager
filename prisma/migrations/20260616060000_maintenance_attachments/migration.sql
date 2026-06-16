-- Maintenance attachments (D follow-up): a loose maintenanceJobId ref on
-- UploadedDocument so photos/invoices can be attached to a maintenance job,
-- reusing the existing upload/serve infrastructure. Additive.
ALTER TABLE "UploadedDocument" ADD COLUMN IF NOT EXISTS "maintenanceJobId" TEXT;
CREATE INDEX IF NOT EXISTS "UploadedDocument_maintenanceJobId_idx"
  ON "UploadedDocument" ("maintenanceJobId");
