-- AlterTable
ALTER TABLE "playlist_event" ADD COLUMN     "auto_adjust" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fixed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "order_id" UUID,
ADD COLUMN     "production_id" UUID,
ADD COLUMN     "related_event_id" UUID,
ADD COLUMN     "segment_id" UUID,
ADD COLUMN     "tc_in_frames" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tc_out_frames" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "playlist_event_production_id_idx" ON "playlist_event"("production_id");

-- CreateIndex
CREATE INDEX "playlist_event_related_event_id_idx" ON "playlist_event"("related_event_id");

-- CreateIndex
CREATE INDEX "playlist_event_order_id_idx" ON "playlist_event"("order_id");

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_related_event_id_fkey" FOREIGN KEY ("related_event_id") REFERENCES "playlist_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
