-- Create rejected_videos table as a blocklist for ingestion.
-- Videos that are definitively unavailable are stored here instead of the main videos table.
-- Ingestion checks this table before making any YouTube API calls.
CREATE TABLE `rejected_videos` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `video_id`    VARCHAR(32)  NOT NULL,
  `reason`      VARCHAR(100) NOT NULL DEFAULT 'unavailable',
  `rejected_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_rejected_video_id` (`video_id`),
  KEY `idx_rejected_videos_video_id` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
