-- AlterTable
ALTER TABLE "airing_item" ADD COLUMN     "break_type_id" UUID,
ADD COLUMN     "position_id" UUID;

-- CreateIndex
CREATE INDEX "airing_item_break_type_id_idx" ON "airing_item"("break_type_id");

-- CreateIndex
CREATE INDEX "airing_item_position_id_idx" ON "airing_item"("position_id");

-- AddForeignKey
ALTER TABLE "airing_item" ADD CONSTRAINT "airing_item_break_type_id_fkey" FOREIGN KEY ("break_type_id") REFERENCES "block_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airing_item" ADD CONSTRAINT "airing_item_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "break_position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
