-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "frame_rate" TEXT NOT NULL,
    "day_start_frames" INTEGER NOT NULL,
    "week_start" INTEGER NOT NULL,
    "time_zone" TEXT,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_playlist" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "block_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "text_color" TEXT NOT NULL,
    "length_frames" INTEGER NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "valid_weekdays" BOOLEAN[],
    "fill_gaps" BOOLEAN NOT NULL DEFAULT true,
    "rotation_list_id" UUID,
    "opens_with_break" BOOLEAN NOT NULL DEFAULT false,
    "limits_per_content_type" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "block_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "active_weekdays" BOOLEAN[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_block" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "block_type_id" UUID NOT NULL,
    "start_frames" INTEGER NOT NULL,
    "length_frames" INTEGER NOT NULL,
    "fill_gaps" BOOLEAN NOT NULL,
    "rotation_list_id" UUID,
    "opens_with_break" BOOLEAN NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "limits_per_content_type" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "template_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linked_break" (
    "id" UUID NOT NULL,
    "block_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "break_type_id" UUID NOT NULL,

    CONSTRAINT "linked_break_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_list" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "positions" INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_list_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "channel_tenant_id_idx" ON "channel"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_tenant_id_code_key" ON "channel"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "channel_playlist_tenant_id_idx" ON "channel_playlist"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_playlist_channel_id_kind_key" ON "channel_playlist"("channel_id", "kind");

-- CreateIndex
CREATE INDEX "block_group_tenant_id_idx" ON "block_group"("tenant_id");

-- CreateIndex
CREATE INDEX "block_type_tenant_id_idx" ON "block_type"("tenant_id");

-- CreateIndex
CREATE INDEX "block_type_playlist_id_idx" ON "block_type"("playlist_id");

-- CreateIndex
CREATE INDEX "template_tenant_id_idx" ON "template"("tenant_id");

-- CreateIndex
CREATE INDEX "template_playlist_id_idx" ON "template"("playlist_id");

-- CreateIndex
CREATE INDEX "template_block_template_id_weekday_idx" ON "template_block"("template_id", "weekday");

-- CreateIndex
CREATE INDEX "template_block_block_type_id_idx" ON "template_block"("block_type_id");

-- CreateIndex
CREATE INDEX "linked_break_break_type_id_idx" ON "linked_break"("break_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "linked_break_block_id_position_key" ON "linked_break"("block_id", "position");

-- CreateIndex
CREATE INDEX "break_list_tenant_id_idx" ON "break_list"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "break_list_channel_id_name_key" ON "break_list"("channel_id", "name");

-- AddForeignKey
ALTER TABLE "channel" ADD CONSTRAINT "channel_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_playlist" ADD CONSTRAINT "channel_playlist_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_group" ADD CONSTRAINT "block_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_type" ADD CONSTRAINT "block_type_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "channel_playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_type" ADD CONSTRAINT "block_type_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "block_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template" ADD CONSTRAINT "template_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "channel_playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_block" ADD CONSTRAINT "template_block_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_block" ADD CONSTRAINT "template_block_block_type_id_fkey" FOREIGN KEY ("block_type_id") REFERENCES "block_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_break" ADD CONSTRAINT "linked_break_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "template_block"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_break" ADD CONSTRAINT "linked_break_break_type_id_fkey" FOREIGN KEY ("break_type_id") REFERENCES "block_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_list" ADD CONSTRAINT "break_list_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
