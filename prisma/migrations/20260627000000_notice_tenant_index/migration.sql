-- Index Notice.tenantId (+ servedAt) — hit on every tenant-portal home load
-- (served-notice count) and the per-tenant activity timeline, both of which
-- filter Notice by tenantId. ADDITIVE, non-destructive.
CREATE INDEX "Notice_tenantId_servedAt_idx" ON "Notice"("tenantId", "servedAt");
