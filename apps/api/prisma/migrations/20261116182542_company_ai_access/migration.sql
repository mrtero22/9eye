-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "ai_access" TEXT NOT NULL DEFAULT 'read',
ADD COLUMN     "ai_token_max_days" INTEGER NOT NULL DEFAULT 90;
