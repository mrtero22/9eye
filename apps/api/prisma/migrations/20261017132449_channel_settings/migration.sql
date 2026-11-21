-- AlterTable
ALTER TABLE "channel" ADD COLUMN     "date_locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
