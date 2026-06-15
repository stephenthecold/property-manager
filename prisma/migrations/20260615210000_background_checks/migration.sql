-- CreateEnum
CREATE TYPE "BackgroundCheckStatus" AS ENUM ('pending', 'clear', 'consider', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "BackgroundCheck" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "BackgroundCheckStatus" NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "summary" TEXT,
    "reportUrl" TEXT,
    "resultJson" JSONB,
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackgroundCheck_applicationId_createdAt_idx" ON "BackgroundCheck"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "BackgroundCheck" ADD CONSTRAINT "BackgroundCheck_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RentalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
