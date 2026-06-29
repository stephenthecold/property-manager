-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totpLockedUntil" TIMESTAMP(3);
