-- CreateTable
CREATE TABLE "ai_provider" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "parts" JSONB NOT NULL,
    "channel_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "skill" TEXT NOT NULL DEFAULT '',
    "works_with" UUID[] DEFAULT ARRAY[]::UUID[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "max_steps" INTEGER NOT NULL DEFAULT 30,
    "monthly_tokens" INTEGER NOT NULL DEFAULT 2000000,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memory" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skill_version" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "skill" TEXT NOT NULL,
    "changed_by_id" UUID,
    "via" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_skill_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_room" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "room_id" UUID,
    "agent_id" UUID,
    "chat_user_id" UUID,
    "thread_id" UUID,
    "author_kind" TEXT NOT NULL,
    "author_user_id" UUID,
    "author_agent_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT NOT NULL,
    "payload" JSONB,
    "run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "requested_by_id" UUID,
    "room_id" UUID,
    "chat_user_id" UUID,
    "thread_id" UUID,
    "chain" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" TEXT NOT NULL DEFAULT 'running',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_change" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "message_id" UUID,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "preview" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "result" TEXT,
    "change_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_tenant_id_provider_key" ON "ai_provider"("tenant_id", "provider");

-- CreateIndex
CREATE INDEX "agent_tenant_id_idx" ON "agent"("tenant_id");

-- CreateIndex
CREATE INDEX "agent_memory_agent_id_idx" ON "agent_memory"("agent_id");

-- CreateIndex
CREATE INDEX "agent_skill_version_agent_id_idx" ON "agent_skill_version"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_room_tenant_id_name_key" ON "agent_room"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "agent_message_tenant_id_room_id_created_at_idx" ON "agent_message"("tenant_id", "room_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_message_agent_id_chat_user_id_created_at_idx" ON "agent_message"("agent_id", "chat_user_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_run_tenant_id_started_at_idx" ON "agent_run"("tenant_id", "started_at");

-- CreateIndex
CREATE INDEX "agent_run_agent_id_started_at_idx" ON "agent_run"("agent_id", "started_at");

-- CreateIndex
CREATE INDEX "agent_change_tenant_id_status_idx" ON "agent_change"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "ai_provider" ADD CONSTRAINT "ai_provider_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skill_version" ADD CONSTRAINT "agent_skill_version_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_room" ADD CONSTRAINT "agent_room_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_change" ADD CONSTRAINT "agent_change_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
