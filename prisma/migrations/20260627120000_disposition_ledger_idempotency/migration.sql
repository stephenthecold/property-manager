-- Defense-in-depth idempotency backstop for deposit-disposition postings: a
-- given disposition may post at most ONE ledger entry of each type — the
-- damages chargeback ('adjustment') and the applied-deposit ('credit'). Scoped
-- to sourceType='deposit_disposition' so it never constrains payments, rent
-- charges, late fees, write-offs, etc. Backstops the status compare-and-swap in
-- finalizeDisposition with a hard DB guarantee against a double-post.
-- (Mirrors the rent_charge/late_fee partial unique indexes — Prisma's schema
-- can't express the WHERE predicate, so it lives in raw SQL here.)
CREATE UNIQUE INDEX "LedgerEntry_deposit_disposition_post_uniq"
  ON "LedgerEntry" ("sourceId", "entryType")
  WHERE "sourceType" = 'deposit_disposition';
