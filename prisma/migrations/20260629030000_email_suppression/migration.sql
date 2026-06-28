-- Email bounce + auto-suppression. Additive + nullable: existing rows get NULL
-- (healthy). The /api/email/bounce webhook sets "emailDeliveryStatus" to
-- "bounced"/"complained" plus "emailSuppressedAt" on a hard bounce / spam
-- complaint; reminder sends then SKIP the email channel for that tenant until
-- staff clear it. NOT a consent flag — it's a deliverability state.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "emailDeliveryStatus" TEXT;

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "emailSuppressedAt" TIMESTAMP(3);
