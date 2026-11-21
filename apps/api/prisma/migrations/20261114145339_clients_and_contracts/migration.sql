-- AlterTable
ALTER TABLE "order" ADD COLUMN     "contract_id" UUID;

-- CreateTable
CREATE TABLE "client" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'advertiser',
    "country" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "billing_address" TEXT NOT NULL DEFAULT '',
    "web" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "fax" TEXT NOT NULL DEFAULT '',
    "vat_number" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "tolerance_seconds" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total_agreed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "import_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_channel" (
    "contract_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,

    CONSTRAINT "contract_channel_pkey" PRIMARY KEY ("contract_id","channel_id")
);

-- CreateIndex
CREATE INDEX "client_tenant_id_idx" ON "client"("tenant_id");

-- CreateIndex
CREATE INDEX "contract_tenant_id_idx" ON "contract"("tenant_id");

-- CreateIndex
CREATE INDEX "contract_client_id_idx" ON "contract"("client_id");

-- CreateIndex
CREATE INDEX "contract_channel_channel_id_idx" ON "contract_channel"("channel_id");

-- CreateIndex
CREATE INDEX "order_contract_id_idx" ON "order"("contract_id");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_channel" ADD CONSTRAINT "contract_channel_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_channel" ADD CONSTRAINT "contract_channel_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
