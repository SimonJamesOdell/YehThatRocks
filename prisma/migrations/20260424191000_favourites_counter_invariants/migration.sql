-- Enforce favourite-counter invariants used by top ranking queries.
-- 1) Remove duplicate (userid, videoId) pairs so distinct-user semantics are stable.
-- 2) Add a uniqueness constraint for future writes.
-- 3) Backfill videos.favourited from exact DISTINCT user counts.

-- Step 1: keep the oldest row per (userid, videoId) pair.
DELETE f1
FROM favourites f1
INNER JOIN favourites f2
  ON f1.userid = f2.userid
 AND f1.videoId = f2.videoId
 AND f1.id > f2.id
WHERE f1.userid IS NOT NULL
  AND f1.videoId IS NOT NULL;

-- Step 2: add unique index safely on drifted environments.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'favourites'
    AND index_name = 'idx_favourites_userid_videoid_unique'
);
SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE favourites ADD UNIQUE INDEX idx_favourites_userid_videoid_unique (userid, videoId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3: ensure stored counter exactly matches distinct-user favourites.
UPDATE videos v
LEFT JOIN (
  SELECT
    f.videoId,
    COUNT(DISTINCT f.userid) AS cnt
  FROM favourites f
  WHERE f.videoId IS NOT NULL
  GROUP BY f.videoId
) fav ON fav.videoId = v.videoId
SET v.favourited = COALESCE(fav.cnt, 0)
WHERE v.videoId IS NOT NULL;
