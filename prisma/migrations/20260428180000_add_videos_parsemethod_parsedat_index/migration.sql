-- Add composite index for classification-audit query hotspot.
-- Query pattern:
--   WHERE parseMethod LIKE 'groq%'
--     AND parsedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
--   GROUP BY DATE(parsedAt)

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'videos'
    AND index_name = 'idx_videos_parsemethod_parsedat'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_videos_parsemethod_parsedat ON videos (parseMethod, parsedAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
