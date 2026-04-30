ALTER TABLE `videos`
  ADD COLUMN `approved` TINYINT(1) NOT NULL DEFAULT 0 AFTER `viewCount`;

UPDATE `videos`
SET `approved` = 1
WHERE `approved` <> 1;

CREATE INDEX `idx_videos_approved_created_at_id`
  ON `videos` (`approved`, `created_at` DESC, `id` DESC);
