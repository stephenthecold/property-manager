-- Phase 5 — H. Settings-driven customization pass. All additive + nullable:
-- existing AppSettings rows get NULL (the resolve layer falls back to the
-- shipped defaults / env). No data is touched.
--
--   reportHeaderText      H3  free-text header block on reports + receipts
--   portalPaymentHelpText H5  tenant portal "how to pay" copy
--   applyConfirmationText H5  public /apply post-submit confirmation copy
--   defaultTablePageSize  H2  default DataTable page size (10/20/50)
--   reminderSendHour      H4  hour-of-day the worker runs the daily sweeps

ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "portalPaymentHelpText" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "applyConfirmationText" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "reportHeaderText" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "defaultTablePageSize" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "reminderSendHour" INTEGER;
