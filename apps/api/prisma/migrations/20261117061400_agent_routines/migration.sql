-- AlterTable
ALTER TABLE "agent_run" ADD COLUMN     "routine_id" UUID;

-- CreateTable
CREATE TABLE "agent_routine" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "time" TEXT,
    "weekdays" BOOLEAN[] DEFAULT ARRAY[]::BOOLEAN[],
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "event" TEXT,
    "channel_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "request" TEXT NOT NULL,
    "room_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_routine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_routine_tenant_id_idx" ON "agent_routine"("tenant_id");

-- CreateIndex
CREATE INDEX "agent_routine_enabled_next_run_at_idx" ON "agent_routine"("enabled", "next_run_at");

-- AddForeignKey
ALTER TABLE "agent_routine" ADD CONSTRAINT "agent_routine_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
