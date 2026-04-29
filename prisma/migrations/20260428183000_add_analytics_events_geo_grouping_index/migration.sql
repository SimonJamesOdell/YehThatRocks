-- Add generated geo-presence flag + covering index for admin geo visitor aggregation.
-- Hot path:
--   SELECT AVG(geo_lat), AVG(geo_lng), COUNT(*), MAX(created_at)
--   FROM analytics_events
--   WHERE has_geo_coords = 1
--   GROUP BY visitor_id
--   ORDER BY MAX(created_at) DESC
--
-- MySQL 8.0 supports indexed generated columns.

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'analytics_events'
    AND column_name = 'has_geo_coords'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE analytics_events ADD COLUMN has_geo_coords TINYINT(1) AS (CASE WHEN geo_lat IS NOT NULL AND geo_lng IS NOT NULL THEN 1 ELSE 0 END) STORED',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'analytics_events'
    AND index_name = 'idx_analytics_events_geo_grouping'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_analytics_events_geo_grouping ON analytics_events (has_geo_coords, visitor_id, created_at, geo_lat, geo_lng)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
