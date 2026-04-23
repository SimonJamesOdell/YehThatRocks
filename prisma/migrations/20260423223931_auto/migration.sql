-- CreateIndex
CREATE INDEX `idx_videos_created_at_id` ON `videos`(`created_at` DESC, `id` DESC);
