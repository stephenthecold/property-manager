-- CreateEnum
CREATE TYPE "RentalApplicationStatus" AS ENUM ('submitted', 'reviewing', 'approved', 'declined', 'withdrawn');

-- CreateTable
CREATE TABLE "RentalApplication" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "currentAddress" TEXT,
    "propertyId" TEXT,
    "unitId" TEXT,
    "desiredMoveInDate" TIMESTAMP(3),
    "monthlyIncomeCents" BIGINT,
    "employer" TEXT,
    "message" TEXT,
    "status" "RentalApplicationStatus" NOT NULL DEFAULT 'submitted',
    "reviewerNotes" TEXT,
    "convertedTenantId" TEXT,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalApplication_status_createdAt_idx" ON "RentalApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RentalApplication_unitId_idx" ON "RentalApplication"("unitId");

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
