-- Record inbox emails as payments. ADDITIVE ONLY: one nullable column on Payment
-- linking a payment back to the captured inbound email it was recorded from /
-- attached to (module "mailbox"), plus an index for the reverse lookup. Pure
-- attribution — never affects allocation or balances. No existing column is
-- altered and no backfill is required.

ALTER TABLE "Payment" ADD COLUMN "sourceEmailId" TEXT;
CREATE INDEX "Payment_sourceEmailId_idx" ON "Payment"("sourceEmailId");
