-- Add approved_at timestamp to track approval recency for New feed sorting
ALTER TABLE `videos` ADD COLUMN `approved_at` DATETIME(3) NULL AFTER `approved`;

-- Backfill approved_at with updated_at for existing approved videos
UPDATE `videos` SET `approved_at` = `updated_at` WHERE `approved` = 1 AND `approved_at` IS NULL;

-- Create index for efficient New feed sorting by approval recency
CREATE INDEX `idx_videos_approved_at_id` ON `videos` (`approved_at` DESC, `id` DESC);
