-- Partial unique indexes for ledger idempotency. @@unique cannot express a WHERE
-- predicate, so these are raw SQL. The charge/late-fee generator inserts with
-- INSERT ... ON CONFLICT DO NOTHING against these, so concurrent/retried runs
-- converge to exactly one charge per (lease, period).

CREATE UNIQUE INDEX "LedgerEntry_rent_charge_period_uniq"
  ON "LedgerEntry" ("leaseId", "periodKey")
  WHERE "entryType" = 'rent_charge';

CREATE UNIQUE INDEX "LedgerEntry_late_fee_period_uniq"
  ON "LedgerEntry" ("leaseId", "periodKey")
  WHERE "entryType" = 'late_fee';

-- A unit may have only one active (or month-to-month) lease at a time.
CREATE UNIQUE INDEX "Lease_one_active_per_unit_uniq"
  ON "Lease" ("unitId")
  WHERE "status" IN ('active', 'month_to_month');

-- Append-only AuditLog: block UPDATE and DELETE at the database level so the
-- audit trail cannot be tampered with, even via a break-glass session.
CREATE OR REPLACE FUNCTION prevent_auditlog_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (UPDATE/DELETE blocked)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditlog_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_auditlog_mutation();
