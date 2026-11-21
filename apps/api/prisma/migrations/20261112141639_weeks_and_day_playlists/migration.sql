-- CreateTable
CREATE TABLE "week" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "first_date" DATE NOT NULL,
    "active_weekdays" BOOLEAN[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "week_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "week_id" UUID NOT NULL,
    "channel_playlist_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_block" (
    "id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "block_type_id" UUID NOT NULL,
    "start_frames" INTEGER NOT NULL,
    "length_frames" INTEGER NOT NULL,
    "fill_gaps" BOOLEAN NOT NULL,
    "rotation_list_id" UUID,
    "opens_with_break" BOOLEAN NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "limits_per_content_type" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "playlist_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_event" (
    "id" UUID NOT NULL,
    "playlist_block_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "length_frames" INTEGER NOT NULL DEFAULT 0,
    "break_type_id" UUID,

    CONSTRAINT "playlist_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "week_tenant_id_idx" ON "week"("tenant_id");

-- CreateIndex
CREATE INDEX "week_template_id_idx" ON "week"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "week_playlist_id_first_date_key" ON "week"("playlist_id", "first_date");

-- CreateIndex
CREATE INDEX "playlist_tenant_id_idx" ON "playlist"("tenant_id");

-- CreateIndex
CREATE INDEX "playlist_week_id_idx" ON "playlist"("week_id");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_channel_playlist_id_date_key" ON "playlist"("channel_playlist_id", "date");

-- CreateIndex
CREATE INDEX "playlist_block_playlist_id_idx" ON "playlist_block"("playlist_id");

-- CreateIndex
CREATE INDEX "playlist_block_block_type_id_idx" ON "playlist_block"("block_type_id");

-- CreateIndex
CREATE INDEX "playlist_event_break_type_id_idx" ON "playlist_event"("break_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_event_playlist_block_id_sequence_key" ON "playlist_event"("playlist_block_id", "sequence");

-- AddForeignKey
ALTER TABLE "week" ADD CONSTRAINT "week_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "channel_playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "week" ADD CONSTRAINT "week_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "week" ADD CONSTRAINT "week_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "week" ADD CONSTRAINT "week_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist" ADD CONSTRAINT "playlist_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist" ADD CONSTRAINT "playlist_channel_playlist_id_fkey" FOREIGN KEY ("channel_playlist_id") REFERENCES "channel_playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_block" ADD CONSTRAINT "playlist_block_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_block" ADD CONSTRAINT "playlist_block_block_type_id_fkey" FOREIGN KEY ("block_type_id") REFERENCES "block_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_playlist_block_id_fkey" FOREIGN KEY ("playlist_block_id") REFERENCES "playlist_block"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_break_type_id_fkey" FOREIGN KEY ("break_type_id") REFERENCES "block_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
