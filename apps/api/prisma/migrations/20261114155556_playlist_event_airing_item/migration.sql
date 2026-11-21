-- AlterTable
ALTER TABLE "playlist_event" ADD COLUMN     "airing_item_id" UUID;

-- CreateIndex
CREATE INDEX "playlist_event_airing_item_id_idx" ON "playlist_event"("airing_item_id");

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_airing_item_id_fkey" FOREIGN KEY ("airing_item_id") REFERENCES "airing_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
