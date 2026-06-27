-- Configurable lease-expiration alert window (dashboard section + weekly digest).
-- Nullable; null falls back to the shipped default (60 days). Additive only.
ALTER TABLE "AppSettings" ADD COLUMN "leaseExpirationAlertDays" INTEGER;

-- Per-staff opt-out for the weekly lease-expiration digest (mirrors the existing
-- digest toggles). Defaults on so the digest reaches manager+ recipients.
ALTER TABLE "User" ADD COLUMN "notifyLeaseExpiration" BOOLEAN NOT NULL DEFAULT true;
