-- AlterTable
ALTER TABLE "content" ADD COLUMN     "age_logo_id" UUID,
ADD COLUMN     "channel_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "channel_logo_id" UUID,
ADD COLUMN     "companies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "directors" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "epg_description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "genres" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "languages" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "length_frames" INTEGER,
ADD COLUMN     "logo1_id" UUID,
ADD COLUMN     "logo2_id" UUID,
ADD COLUMN     "logo3_id" UUID,
ADD COLUMN     "logo4_id" UUID,
ADD COLUMN     "nationalities" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "next_production_id" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "original_title" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "secondary_action_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "segment_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "synopsis" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "content_type" ADD COLUMN     "contract_free" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "epg_desc_from_content" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "epg_desc_from_production" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "epg_name_from_block" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "epg_name_from_content" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "epg_short_from_content" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "epg_short_from_production" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "has_logo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_chapter_in_grid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_in_epg" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_in_grid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_in_press" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_segment_in_grid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_title_in_grid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "production" ADD COLUMN     "actors" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "additional_data" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "channel_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "custom_values" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "directors" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "epg_description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "external_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "genres" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "is_default_chapter" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "languages" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "media_available" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nationalities" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "original_title" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "proxy_available" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "published_externally" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "secondary_action_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "segment_count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "synopsis" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "thematics" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "thumbnail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "catalog_frame_rate" TEXT NOT NULL DEFAULT '25';

-- CreateTable
CREATE TABLE "segmentation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "production_id" UUID NOT NULL,
    "code" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "external_id" TEXT NOT NULL DEFAULT '',
    "thumbnail" TEXT NOT NULL DEFAULT '',
    "media_available" BOOLEAN NOT NULL DEFAULT false,
    "proxy_available" BOOLEAN NOT NULL DEFAULT false,
    "published_externally" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "segmentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment" (
    "id" UUID NOT NULL,
    "segmentation_id" UUID NOT NULL,
    "code" INTEGER NOT NULL,
    "source_id" UUID,
    "media_id" TEXT NOT NULL DEFAULT '',
    "tc_in_frames" INTEGER,
    "tc_out_frames" INTEGER,
    "length_frames" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "external_id" TEXT NOT NULL DEFAULT '',
    "thumbnail" TEXT NOT NULL DEFAULT '',
    "media_available" BOOLEAN NOT NULL DEFAULT false,
    "proxy_available" BOOLEAN NOT NULL DEFAULT false,
    "published_externally" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "media_id_generation" TEXT NOT NULL DEFAULT 'production-id',
    "custom_pattern" TEXT NOT NULL DEFAULT '',
    "is_live" BOOLEAN NOT NULL DEFAULT false,
    "syncable" BOOLEAN NOT NULL DEFAULT false,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logo_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logo_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "logo_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secondary_action" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secondary_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "position" INTEGER NOT NULL DEFAULT 0,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_list" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "last_item_position" INTEGER,
    "insertion_days_interval" INTEGER NOT NULL DEFAULT 0,
    "allow_same_day_repeat" BOOLEAN NOT NULL DEFAULT false,
    "random_insert" BOOLEAN NOT NULL DEFAULT false,
    "apply_channel_restrictions" BOOLEAN NOT NULL DEFAULT false,
    "allow_production_repeats" BOOLEAN NOT NULL DEFAULT false,
    "allow_overlap" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "rotation_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_list_item" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "production_id" UUID NOT NULL,
    "segmentation_id" UUID,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "inserted_at" TIMESTAMP(3),
    "import_ref" TEXT,

    CONSTRAINT "rotation_list_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graphic_source" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "channel_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "graphic_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graphic_object" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "layer" TEXT NOT NULL DEFAULT 'auto',
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "graphic_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graphic_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "object_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "start_type" TEXT NOT NULL DEFAULT 'from-start',
    "start_offset_frames" INTEGER NOT NULL DEFAULT 0,
    "start_tc_in_frames" INTEGER NOT NULL DEFAULT 0,
    "end_type" TEXT NOT NULL DEFAULT 'automatic',
    "end_duration_frames" INTEGER NOT NULL DEFAULT 0,
    "end_tc_out_frames" INTEGER NOT NULL DEFAULT 0,
    "frequency" TEXT NOT NULL DEFAULT 'once',
    "repeat_interval_frames" INTEGER NOT NULL DEFAULT 0,
    "repeat_count" INTEGER NOT NULL DEFAULT 0,
    "layer" TEXT NOT NULL DEFAULT 'auto',
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "graphic_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_window" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "length_frames" INTEGER NOT NULL DEFAULT 0,
    "show_in_grid" BOOLEAN NOT NULL DEFAULT false,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_window_range" (
    "id" UUID NOT NULL,
    "time_window_id" UUID NOT NULL,
    "channel_id" UUID,
    "weekday" INTEGER NOT NULL,
    "start_frames" INTEGER NOT NULL,
    "length_frames" INTEGER NOT NULL,

    CONSTRAINT "time_window_range_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_code" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_relation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "channel_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "params" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_relation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segmentation_tenant_id_idx" ON "segmentation"("tenant_id");

-- CreateIndex
CREATE INDEX "segmentation_production_id_idx" ON "segmentation"("production_id");

-- CreateIndex
CREATE INDEX "segment_segmentation_id_idx" ON "segment"("segmentation_id");

-- CreateIndex
CREATE INDEX "source_tenant_id_idx" ON "source"("tenant_id");

-- CreateIndex
CREATE INDEX "logo_type_tenant_id_idx" ON "logo_type"("tenant_id");

-- CreateIndex
CREATE INDEX "logo_tenant_id_idx" ON "logo"("tenant_id");

-- CreateIndex
CREATE INDEX "secondary_action_tenant_id_idx" ON "secondary_action"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_tenant_id_entity_key_key" ON "custom_field"("tenant_id", "entity", "key");

-- CreateIndex
CREATE INDEX "rotation_list_tenant_id_idx" ON "rotation_list"("tenant_id");

-- CreateIndex
CREATE INDEX "rotation_list_item_list_id_idx" ON "rotation_list_item"("list_id");

-- CreateIndex
CREATE INDEX "rotation_list_item_production_id_idx" ON "rotation_list_item"("production_id");

-- CreateIndex
CREATE INDEX "graphic_source_tenant_id_idx" ON "graphic_source"("tenant_id");

-- CreateIndex
CREATE INDEX "graphic_object_tenant_id_idx" ON "graphic_object"("tenant_id");

-- CreateIndex
CREATE INDEX "graphic_template_tenant_id_idx" ON "graphic_template"("tenant_id");

-- CreateIndex
CREATE INDEX "time_window_tenant_id_idx" ON "time_window"("tenant_id");

-- CreateIndex
CREATE INDEX "time_window_range_time_window_id_idx" ON "time_window_range"("time_window_id");

-- CreateIndex
CREATE INDEX "product_code_tenant_id_idx" ON "product_code"("tenant_id");

-- CreateIndex
CREATE INDEX "catalog_relation_tenant_id_item_id_idx" ON "catalog_relation"("tenant_id", "item_id");

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production" ADD CONSTRAINT "production_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segmentation" ADD CONSTRAINT "segmentation_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment" ADD CONSTRAINT "segment_segmentation_id_fkey" FOREIGN KEY ("segmentation_id") REFERENCES "segmentation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment" ADD CONSTRAINT "segment_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logo" ADD CONSTRAINT "logo_logo_type_id_fkey" FOREIGN KEY ("logo_type_id") REFERENCES "logo_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_list_item" ADD CONSTRAINT "rotation_list_item_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "rotation_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_list_item" ADD CONSTRAINT "rotation_list_item_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_list_item" ADD CONSTRAINT "rotation_list_item_segmentation_id_fkey" FOREIGN KEY ("segmentation_id") REFERENCES "segmentation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graphic_object" ADD CONSTRAINT "graphic_object_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "graphic_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graphic_template" ADD CONSTRAINT "graphic_template_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "graphic_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graphic_template" ADD CONSTRAINT "graphic_template_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "graphic_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_window_range" ADD CONSTRAINT "time_window_range_time_window_id_fkey" FOREIGN KEY ("time_window_id") REFERENCES "time_window"("id") ON DELETE CASCADE ON UPDATE CASCADE;
