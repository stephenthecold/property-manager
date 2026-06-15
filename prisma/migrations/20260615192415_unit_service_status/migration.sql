-- Replace the overloaded Unit.occupancyStatus with a manual serviceability axis.
-- Occupancy ("is it leased") is now DERIVED from the active Lease, not stored.

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('in_service', 'maintenance', 'unavailable');

-- AlterTable: add the new manual axis (default in_service)
ALTER TABLE "Unit" ADD COLUMN "serviceStatus" "ServiceStatus" NOT NULL DEFAULT 'in_service';

-- Backfill: preserve out-of-service intent; vacant/occupied collapse to in_service
-- (occupancy is now derived from leases).
UPDATE "Unit" SET "serviceStatus" = 'maintenance' WHERE "occupancyStatus" = 'maintenance';
UPDATE "Unit" SET "serviceStatus" = 'unavailable' WHERE "occupancyStatus" = 'unavailable';

-- Drop the overloaded column + enum
ALTER TABLE "Unit" DROP COLUMN "occupancyStatus";
DROP TYPE "OccupancyStatus";
