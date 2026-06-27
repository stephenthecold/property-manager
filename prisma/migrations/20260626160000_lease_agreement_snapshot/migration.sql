-- Per-lease lease-agreement wording snapshot. ADDITIVE ONLY: one nullable
-- column on Lease. Editing the org-wide template (AppSettings.leaseAgreementText)
-- must never change an existing lease's agreement, so each lease freezes the
-- clause template (with {{placeholders}}) it was issued under. NULL means "use
-- the built-in default", and a null lease is pinned to that default — it never
-- adopts a newly-set org template. No existing column is altered.
ALTER TABLE "Lease" ADD COLUMN "agreementText" TEXT;

-- Backfill every existing lease with the wording in effect now: the operator's
-- current custom template when one is set, otherwise NULL (= built-in default).
-- This pins all existing leases as of today, so future template edits leave
-- them unchanged. AppSettings is a singleton (id = 'singleton').
UPDATE "Lease"
SET "agreementText" = (
  SELECT NULLIF("leaseAgreementText", '')
  FROM "AppSettings"
  WHERE "id" = 'singleton'
)
WHERE "agreementText" IS NULL;
