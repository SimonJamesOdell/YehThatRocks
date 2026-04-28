-- Add a covering index for playlist reads on the aligned numeric schema.
-- Hot path:
--   SELECT ...
--   FROM playlistitems pi
--   INNER JOIN videos v ON v.id = pi.video_id
--   WHERE pi.playlist_id = ?
--   ORDER BY pi.sort_order ASC, pi.id ASC

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'playlistitems'
    AND index_name = 'idx_playlistitems_playlist_order_video'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_playlistitems_playlist_order_video ON playlistitems (playlist_id, sort_order, id, video_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;