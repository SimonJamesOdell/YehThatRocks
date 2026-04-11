-- Add performance indexes for hottest catalog reads (newest/top/watch-next).
-- Guard each index creation so this migration is safe on partially drifted schemas.

-- site_videos(status, video_id)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'site_videos'
    AND index_name = 'idx_site_videos_status_video_id'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_site_videos_status_video_id ON site_videos (status, video_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- site_videos(video_id, status)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'site_videos'
    AND index_name = 'idx_site_videos_video_id_status'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_site_videos_video_id_status ON site_videos (video_id, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- videos(updated_at, created_at, id)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'videos'
    AND index_name = 'idx_videos_updated_created_id'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_videos_updated_created_id ON videos (updated_at, created_at, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- videos(favourited, viewCount, videoId)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'videos'
    AND index_name = 'idx_videos_favourited_viewcount_videoid'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_videos_favourited_viewcount_videoid ON videos (favourited, viewCount, videoId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- videos(parsedArtist, viewCount, id)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'videos'
    AND index_name = 'idx_videos_parsed_artist_viewcount_id'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_videos_parsed_artist_viewcount_id ON videos (parsedArtist, viewCount, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
