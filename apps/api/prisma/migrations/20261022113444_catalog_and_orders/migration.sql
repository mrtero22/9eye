-- CreateTable
CREATE TABLE "content_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "family" TEXT NOT NULL,
    "color" TEXT,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "content_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "content_type_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "season" TEXT,
    "valid_from" DATE,
    "valid_to" DATE,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "chapter" INTEGER,
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "length_frames" INTEGER,
    "starts" DATE,
    "expires" DATE,
    "media_status" TEXT,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "color" TEXT NOT NULL,
    "first_item_id" UUID,
    "reuse_in_loop" BOOLEAN NOT NULL DEFAULT false,
    "max_airings" INTEGER,
    "total_airings" INTEGER,
    "time_windows" JSONB NOT NULL DEFAULT '{"allowed":[],"rejected":[]}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_channel" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "order_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "production_id" UUID NOT NULL,
    "length_frames" INTEGER,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airing" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "block_type_id" UUID NOT NULL,
    "passes" INTEGER NOT NULL DEFAULT 1,
    "repeat_of_id" UUID,
    "repeat_index" INTEGER NOT NULL DEFAULT 0,
    "block_color" TEXT,
    "import_ref" TEXT,

    CONSTRAINT "airing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airing_item" (
    "id" UUID NOT NULL,
    "airing_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "order_item_id" UUID NOT NULL,
    "passes" INTEGER NOT NULL DEFAULT 1,
    "jingle" TEXT,

    CONSTRAINT "airing_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_type_tenant_id_idx" ON "content_type"("tenant_id");

-- CreateIndex
CREATE INDEX "content_tenant_id_idx" ON "content"("tenant_id");

-- CreateIndex
CREATE INDEX "content_content_type_id_idx" ON "content"("content_type_id");

-- CreateIndex
CREATE INDEX "production_tenant_id_idx" ON "production"("tenant_id");

-- CreateIndex
CREATE INDEX "production_content_id_idx" ON "production"("content_id");

-- CreateIndex
CREATE INDEX "order_tenant_id_idx" ON "order"("tenant_id");

-- CreateIndex
CREATE INDEX "order_channel_channel_id_idx" ON "order_channel"("channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_channel_order_id_channel_id_key" ON "order_channel"("order_id", "channel_id");

-- CreateIndex
CREATE INDEX "order_item_order_id_idx" ON "order_item"("order_id");

-- CreateIndex
CREATE INDEX "order_item_production_id_idx" ON "order_item"("production_id");

-- CreateIndex
CREATE INDEX "airing_tenant_id_idx" ON "airing"("tenant_id");

-- CreateIndex
CREATE INDEX "airing_channel_id_date_idx" ON "airing"("channel_id", "date");

-- CreateIndex
CREATE INDEX "airing_repeat_of_id_idx" ON "airing"("repeat_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "airing_order_id_channel_id_date_block_type_id_key" ON "airing"("order_id", "channel_id", "date", "block_type_id");

-- CreateIndex
CREATE INDEX "airing_item_airing_id_idx" ON "airing_item"("airing_id");

-- CreateIndex
CREATE INDEX "airing_item_order_item_id_idx" ON "airing_item"("order_item_id");

-- AddForeignKey
ALTER TABLE "content_type" ADD CONSTRAINT "content_type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_content_type_id_fkey" FOREIGN KEY ("content_type_id") REFERENCES "content_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_channel" ADD CONSTRAINT "order_channel_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_channel" ADD CONSTRAINT "order_channel_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_channel" ADD CONSTRAINT "order_channel_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airing" ADD CONSTRAINT "airing_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airing" ADD CONSTRAINT "airing_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airing" ADD CONSTRAINT "airing_block_type_id_fkey" FOREIGN KEY ("block_type_id") REFERENCES "block_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airing" ADD CONSTRAINT "airing_repeat_of_id_fkey" FOREIGN KEY ("repeat_of_id") REFERENCES "airing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airing_item" ADD CONSTRAINT "airing_item_airing_id_fkey" FOREIGN KEY ("airing_id") REFERENCES "airing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airing_item" ADD CONSTRAINT "airing_item_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
