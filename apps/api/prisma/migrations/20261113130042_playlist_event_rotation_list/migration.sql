-- AlterTable
ALTER TABLE "playlist_event" ADD COLUMN     "rotation_list_id" UUID;

-- CreateIndex
CREATE INDEX "playlist_event_rotation_list_id_idx" ON "playlist_event"("rotation_list_id");

-- AddForeignKey
ALTER TABLE "playlist_event" ADD CONSTRAINT "playlist_event_rotation_list_id_fkey" FOREIGN KEY ("rotation_list_id") REFERENCES "rotation_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;
