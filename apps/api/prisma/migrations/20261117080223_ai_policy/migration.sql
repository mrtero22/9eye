-- AlterTable
ALTER TABLE "access_token" ADD COLUMN     "policy" JSONB;

-- AlterTable
ALTER TABLE "agent_change" ADD COLUMN     "token_id" UUID,
ADD COLUMN     "user_id" UUID,
ALTER COLUMN "agent_id" DROP NOT NULL,
ALTER COLUMN "run_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "ai_policy" JSONB;
