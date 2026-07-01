-- Event-driven staff notifications: alert opted-in staff when a payment posts
-- and when a tenant submits a maintenance request. Additive, default-on.
ALTER TABLE "User" ADD COLUMN     "notifyPaymentRecorded" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN     "notifyMaintenanceRequest" BOOLEAN NOT NULL DEFAULT true;
