-- Staff can now post one-off ledger entries (security/pet deposits, a missed
-- move-in prorate, other charges, and credits/concessions) outside automated
-- billing. Each manual posting carries a client-minted idempotency token in
-- "sourceId" under sourceType='manual_charge'; this partial unique index makes a
-- double-submit (or a retried request) a caught no-op instead of a duplicate
-- money entry. A reversal of a manual entry stores sourceId='reverse:<entryId>',
-- so the same index also makes reversing idempotent. Mirrors the existing
-- rent_charge/late_fee and PropertyExpense idempotency indexes.
CREATE UNIQUE INDEX "LedgerEntry_manual_charge_source_uniq"
  ON "LedgerEntry" ("sourceType", "sourceId")
  WHERE "sourceType" = 'manual_charge';
