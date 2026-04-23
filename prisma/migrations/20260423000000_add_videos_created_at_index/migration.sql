-- Add composite index on (created_at DESC, id DESC) to support efficient newest-first ordering
-- for the New section. Without this index MySQL had to sort all ~266k rows on every query.
CREATE INDEX `idx_videos_created_at_id` ON `videos`(`created_at` DESC, `id` DESC);
