-- AlterTable
ALTER TABLE "Building" ADD COLUMN     "purchaseDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lease" ADD COLUMN     "scheduledRentAmountCents" BIGINT,
ADD COLUMN     "scheduledRentEffectiveDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "internetEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "internetFeeCents" BIGINT NOT NULL DEFAULT 2500;
