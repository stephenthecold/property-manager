-- Inbox poll health. ADDITIVE ONLY: six nullable columns on AppSettings that the
-- worker writes after each mailbox poll, so Settings → Email inbox can show
-- whether polling is running (and the last error) without server logs. No
-- existing column is altered.

ALTER TABLE "AppSettings" ADD COLUMN "inboxLastPolledAt" TIMESTAMP(3);
ALTER TABLE "AppSettings" ADD COLUMN "inboxLastFetched" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN "inboxLastProcessed" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN "inboxLastFailed" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN "inboxLastError" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxLastErrorAt" TIMESTAMP(3);
