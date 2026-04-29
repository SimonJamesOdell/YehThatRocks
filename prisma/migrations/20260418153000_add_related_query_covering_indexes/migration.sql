-- Add covering indexes for recommendation/artist lookups without changing behavior.
-- Guards keep this migration safe on drifted schemas.

-- videos(parsed_artist_norm, favourited, viewCount, videoId, id)
SET @col_ok := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'videos'
    AND column_name = 'parsed_artist_norm'
);
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'videos'
    AND index_name = 'idx_videos_parsed_artist_norm_fav_view_videoid_id'
);
SET @sql := IF(
  @col_ok > 0 AND @idx_exists = 0,
  'CREATE INDEX idx_videos_parsed_artist_norm_fav_view_videoid_id ON videos (parsed_artist_norm, favourited, viewCount, videoId, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- artists(artist_name_norm, artist)
SET @col_ok := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'artists'
    AND column_name = 'artist_name_norm'
);
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'artists'
    AND index_name = 'idx_artists_artist_name_norm_artist'
);
SET @sql := IF(
  @col_ok > 0 AND @idx_exists = 0,
  'CREATE INDEX idx_artists_artist_name_norm_artist ON artists (artist_name_norm, artist)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
