-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "rolePermissions" JSONB NOT NULL DEFAULT '{}';
