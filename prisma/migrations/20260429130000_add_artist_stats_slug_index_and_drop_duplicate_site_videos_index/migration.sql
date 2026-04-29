SET @artist_stats_slug_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'artist_stats'
    AND index_name = 'artist_stats_slug_idx'
);

SET @sql := IF(
  @artist_stats_slug_idx_exists = 0,
  'CREATE INDEX artist_stats_slug_idx ON artist_stats (slug)',
  'SELECT ''artist_stats_slug_idx already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @duplicate_site_videos_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'site_videos'
    AND index_name = 'idx_site_videos_video_id_status'
);

SET @sql := IF(
  @duplicate_site_videos_idx_exists > 0,
  'DROP INDEX idx_site_videos_video_id_status ON site_videos',
  'SELECT ''idx_site_videos_video_id_status already absent'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ANALYZE TABLE artist_stats, site_videos;