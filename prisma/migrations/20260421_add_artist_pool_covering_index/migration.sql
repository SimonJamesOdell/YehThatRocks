-- Optimization: Add covering composite index for artist-pool queries.
-- This includes all columns selected by getArtistVideoPoolByNormalizedName:
-- - parsed_artist_norm (WHERE clause, for filtering)
-- - favourited, viewCount (ORDER BY)
-- - videoId, title, parsedArtist, description (SELECT list)
-- Together these make the index "covering" so the optimizer avoids table lookups.

SET @has_covering_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'videos'
    AND INDEX_NAME = 'idx_videos_artist_pool_covering'
);

SET @sql_covering_idx := IF(
  @has_covering_idx = 0,
  'ALTER TABLE `videos` ADD INDEX `idx_videos_artist_pool_covering` (
    `parsed_artist_norm`,
    `favourited` DESC,
    `viewCount` DESC,
    `videoId`,
    `title`,
    `parsedArtist`,
    `description`
  )',
  'SELECT 1'
);

PREPARE stmt_covering_idx FROM @sql_covering_idx;
EXECUTE stmt_covering_idx;
DEALLOCATE PREPARE stmt_covering_idx;
