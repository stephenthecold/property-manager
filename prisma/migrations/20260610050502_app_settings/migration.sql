-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "businessName" TEXT,
    "businessLegalName" TEXT,
    "businessAddress" TEXT,
    "businessPhone" TEXT,
    "businessEmail" TEXT,
    "logoDocumentId" TEXT,
    "receiptFooter" TEXT,
    "defaultTimezone" TEXT,
    "defaultCurrency" TEXT,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsProvider" TEXT,
    "smsAccountSid" TEXT,
    "smsAuthTokenCiphertext" TEXT,
    "smsAuthTokenNonce" TEXT,
    "smsAuthTokenTag" TEXT,
    "smsFromNumber" TEXT,
    "reminderDueSoonDays" INTEGER,
    "dueSoonRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "overdueRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsTemplates" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);
