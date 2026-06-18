-- Initiative H — reminder delivery/read tracking. Additive + nullable: existing
-- rows get NULL. "deliveredAt" is set when the provider reports terminal delivery
-- (Twilio MessageStatus=delivered); "failedReason" holds the provider failure
-- detail (Twilio ErrorCode/ErrorMessage), truncated by the service layer.

ALTER TABLE "Reminder" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

ALTER TABLE "Reminder" ADD COLUMN IF NOT EXISTS "failedReason" TEXT;
