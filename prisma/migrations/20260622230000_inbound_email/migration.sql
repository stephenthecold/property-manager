-- Inbound email inbox (module "mailbox"). ADDITIVE ONLY: a new InboundEmail
-- table, nullable AppSettings IMAP-config columns (secrets encrypted at rest),
-- two loose-ref columns on UploadedDocument, and one new UploadType enum value.
-- Nothing existing is altered or back-filled.

-- New document type for files pulled off an inbound email. (ADD VALUE is not
-- used elsewhere in this migration, so it is safe inside the transaction.)
ALTER TYPE "UploadType" ADD VALUE 'email_attachment';

-- AppSettings: IMAP mailbox configuration. All nullable; the three secrets are
-- stored as AES-256-GCM ciphertext/nonce/tag triplets (never plaintext).
ALTER TABLE "AppSettings" ADD COLUMN "inboxEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "inboxProvider" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxImapHost" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxImapPort" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN "inboxImapSecure" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AppSettings" ADD COLUMN "inboxImapUser" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxFolder" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxAuthMethod" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxPasswordCiphertext" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxPasswordNonce" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxPasswordTag" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthClientId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthTokenUrl" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthScope" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthClientSecretCiphertext" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthClientSecretNonce" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthClientSecretTag" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthRefreshTokenCiphertext" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthRefreshTokenNonce" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthRefreshTokenTag" TEXT;

-- UploadedDocument: link an attachment to its source email and (once posted)
-- to the created expense.
ALTER TABLE "UploadedDocument" ADD COLUMN "inboundEmailId" TEXT;
ALTER TABLE "UploadedDocument" ADD COLUMN "propertyExpenseId" TEXT;
CREATE INDEX "UploadedDocument_inboundEmailId_idx" ON "UploadedDocument"("inboundEmailId");
CREATE INDEX "UploadedDocument_propertyExpenseId_idx" ON "UploadedDocument"("propertyExpenseId");

-- InboundEmail: one row per captured email. Idempotent on messageId.
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toAddress" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'new',
    "tenantId" TEXT,
    "propertyExpenseId" TEXT,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");
CREATE INDEX "InboundEmail_status_receivedAt_idx" ON "InboundEmail"("status", "receivedAt");
CREATE INDEX "InboundEmail_tenantId_idx" ON "InboundEmail"("tenantId");
CREATE INDEX "InboundEmail_readAt_idx" ON "InboundEmail"("readAt");
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
