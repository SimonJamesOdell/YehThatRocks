-- Task 2: index-friendly artist normalization support.
-- Add generated normalized columns and indexes if missing.

SET @has_videos_norm_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'videos'
    AND COLUMN_NAME = 'parsed_artist_norm'
);
SET @sql_videos_norm_col := IF(
  @has_videos_norm_col = 0,
  'ALTER TABLE `videos` ADD COLUMN `parsed_artist_norm` VARCHAR(255) GENERATED ALWAYS AS (LOWER(TRIM(`parsedArtist`))) STORED',
  'SELECT 1'
);
PREPARE stmt_videos_norm_col FROM @sql_videos_norm_col;
EXECUTE stmt_videos_norm_col;
DEALLOCATE PREPARE stmt_videos_norm_col;

SET @has_videos_norm_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'videos'
    AND INDEX_NAME = 'idx_videos_parsed_artist_norm'
);
SET @sql_videos_norm_idx := IF(
  @has_videos_norm_idx = 0,
  'ALTER TABLE `videos` ADD INDEX `idx_videos_parsed_artist_norm` (`parsed_artist_norm`)',
  'SELECT 1'
);
PREPARE stmt_videos_norm_idx FROM @sql_videos_norm_idx;
EXECUTE stmt_videos_norm_idx;
DEALLOCATE PREPARE stmt_videos_norm_idx;

SET @has_artists_norm_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'artists'
    AND COLUMN_NAME = 'artist_name_norm'
);
SET @sql_artists_norm_col := IF(
  @has_artists_norm_col = 0,
  'ALTER TABLE `artists` ADD COLUMN `artist_name_norm` VARCHAR(255) GENERATED ALWAYS AS (LOWER(TRIM(`artist`))) STORED',
  'SELECT 1'
);
PREPARE stmt_artists_norm_col FROM @sql_artists_norm_col;
EXECUTE stmt_artists_norm_col;
DEALLOCATE PREPARE stmt_artists_norm_col;

SET @has_artists_norm_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'artists'
    AND INDEX_NAME = 'idx_artists_artist_name_norm'
);
SET @sql_artists_norm_idx := IF(
  @has_artists_norm_idx = 0,
  'ALTER TABLE `artists` ADD INDEX `idx_artists_artist_name_norm` (`artist_name_norm`)',
  'SELECT 1'
);
PREPARE stmt_artists_norm_idx FROM @sql_artists_norm_idx;
EXECUTE stmt_artists_norm_idx;
DEALLOCATE PREPARE stmt_artists_norm_idx;
