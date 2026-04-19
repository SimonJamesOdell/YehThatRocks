-- Add covering indexes on the `related` table for the directRelatedPromise hot path.
-- Without these, every WHERE/EXISTS referencing related(videoId) or related(related)
-- degenerates to a full table scan.  Guard each creation so the migration is safe
-- on already-patched schemas.

-- related(videoId, related) — forward lookup: "find all related entries for a given video"
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'related'
    AND index_name = 'idx_related_videoid_related'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_related_videoid_related ON related (videoId, related)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- related(related, videoId) — reverse lookup: "find all source videos that have this video as a related entry"
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'related'
    AND index_name = 'idx_related_related_videoid'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_related_related_videoid ON related (related, videoId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
