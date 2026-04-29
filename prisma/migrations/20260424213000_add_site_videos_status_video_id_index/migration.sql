-- Support EXISTS-based availability filters with a status-first lookup path.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'site_videos'
    AND index_name = 'idx_site_videos_status_video_id'
);
SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE site_videos ADD INDEX idx_site_videos_status_video_id (status, video_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
