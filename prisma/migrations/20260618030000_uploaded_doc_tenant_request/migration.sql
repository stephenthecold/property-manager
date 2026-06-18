-- Loose ref so a tenant can attach photos to a maintenance request (mirrors the
-- existing maintenanceJobId ref). Additive + nullable: existing rows get NULL.

ALTER TABLE "UploadedDocument" ADD COLUMN IF NOT EXISTS "tenantRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "UploadedDocument_tenantRequestId_idx"
  ON "UploadedDocument" ("tenantRequestId");
