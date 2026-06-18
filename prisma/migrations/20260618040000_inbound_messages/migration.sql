-- Two-way SMS inbox (Initiative H): capture inbound (non-keyword) SMS replies into
-- a per-tenant thread staff can read. STOP/START/HELP keywords are handled by the
-- consent flow and are NOT stored here. Operational record only — never a ledger
-- entry, never affects balances. Additive, re-runnable.

CREATE TABLE IF NOT EXISTS "InboundMessage" (
  "id"          TEXT NOT NULL,
  "channel"     TEXT NOT NULL DEFAULT 'sms',
  "fromPhone"   TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "tenantId"    TEXT,
  "providerSid" TEXT,
  "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"      TIMESTAMP(3),
  CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InboundMessage_tenantId_idx" ON "InboundMessage" ("tenantId");
CREATE INDEX IF NOT EXISTS "InboundMessage_readAt_idx" ON "InboundMessage" ("readAt");
CREATE INDEX IF NOT EXISTS "InboundMessage_receivedAt_idx" ON "InboundMessage" ("receivedAt");

-- Tenant FK: a captured message keeps its history if the tenant is later removed
-- (SET NULL), matching the model's onDelete: SetNull. Guard so it's re-runnable.
DO $$ BEGIN
  ALTER TABLE "InboundMessage"
    ADD CONSTRAINT "InboundMessage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
