-- AlterTable
ALTER TABLE "audit_event" ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB;
