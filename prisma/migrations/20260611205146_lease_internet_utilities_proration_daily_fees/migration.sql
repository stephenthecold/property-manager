-- AlterEnum
ALTER TYPE "LateFeeType" ADD VALUE 'daily';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "defaultLateFeeMaxCents" BIGINT;

-- AlterTable
ALTER TABLE "Lease" ADD COLUMN     "internetEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "internetFeeCents" BIGINT NOT NULL DEFAULT 2500,
ADD COLUMN     "lateFeeMaxCents" BIGINT,
ADD COLUMN     "prorateFirstPeriod" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "utilitiesNotes" TEXT,
ADD COLUMN     "utilitiesPaid" JSONB NOT NULL DEFAULT '[]';

-- Internet billing moves from the unit to the lease (the unit fields remain
-- the default for NEW leases). Carry each existing lease's behavior over so
-- billing output is unchanged by this migration.
UPDATE "Lease" l
SET "internetEnabled" = u."internetEnabled",
    "internetFeeCents" = u."internetFeeCents"
FROM "Unit" u
WHERE l."unitId" = u."id";
