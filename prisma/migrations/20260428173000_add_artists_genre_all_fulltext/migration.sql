-- Add artists.genre_all + FULLTEXT index to accelerate genre filtering.
-- Keep migration safe on partially drifted schemas with guarded DDL.

-- 1) Add genre_all column if missing.
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'artists'
    AND column_name = 'genre_all'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE artists ADD COLUMN genre_all TEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Backfill genre_all from genre1..genre6.
UPDATE artists
SET genre_all = TRIM(CONCAT_WS(' ',
  NULLIF(TRIM(genre1), ''),
  NULLIF(TRIM(genre2), ''),
  NULLIF(TRIM(genre3), ''),
  NULLIF(TRIM(genre4), ''),
  NULLIF(TRIM(genre5), ''),
  NULLIF(TRIM(genre6), '')
));

-- 3) Create FULLTEXT index if missing.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'artists'
    AND index_name = 'idx_artists_genre_all_fulltext'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE FULLTEXT INDEX idx_artists_genre_all_fulltext ON artists (genre_all)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) Keep genre_all synchronized on writes.
DROP TRIGGER IF EXISTS trg_artists_genre_all_bi;
CREATE TRIGGER trg_artists_genre_all_bi
BEFORE INSERT ON artists
FOR EACH ROW
SET NEW.genre_all = TRIM(CONCAT_WS(' ',
  NULLIF(TRIM(NEW.genre1), ''),
  NULLIF(TRIM(NEW.genre2), ''),
  NULLIF(TRIM(NEW.genre3), ''),
  NULLIF(TRIM(NEW.genre4), ''),
  NULLIF(TRIM(NEW.genre5), ''),
  NULLIF(TRIM(NEW.genre6), '')
));

DROP TRIGGER IF EXISTS trg_artists_genre_all_bu;
CREATE TRIGGER trg_artists_genre_all_bu
BEFORE UPDATE ON artists
FOR EACH ROW
SET NEW.genre_all = TRIM(CONCAT_WS(' ',
  NULLIF(TRIM(NEW.genre1), ''),
  NULLIF(TRIM(NEW.genre2), ''),
  NULLIF(TRIM(NEW.genre3), ''),
  NULLIF(TRIM(NEW.genre4), ''),
  NULLIF(TRIM(NEW.genre5), ''),
  NULLIF(TRIM(NEW.genre6), '')
));
