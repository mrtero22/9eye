-- CreateTable
CREATE TABLE "break_position" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "price_modifier" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "content_type_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "break_position_tenant_id_idx" ON "break_position"("tenant_id");
