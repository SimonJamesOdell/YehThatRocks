-- Safe, idempotent schema alignment for legacy VPS databases.
-- Goal: make legacy tables compatible with current Prisma schema without destructive resets.
-- This script only adds/backfills columns and normalizes data; it does not drop tables.

START TRANSACTION;

DELIMITER //

DROP PROCEDURE IF EXISTS ytr_exec_sql //
CREATE PROCEDURE ytr_exec_sql(IN p_sql TEXT)
BEGIN
  SET @stmt = p_sql;
  PREPARE s FROM @stmt;
  EXECUTE s;
  DEALLOCATE PREPARE s;
END //

DROP PROCEDURE IF EXISTS ytr_exec_if_col_missing //
CREATE PROCEDURE ytr_exec_if_col_missing(IN p_table VARCHAR(64), IN p_col VARCHAR(64), IN p_sql TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND column_name = p_col
  ) THEN
    CALL ytr_exec_sql(p_sql);
  END IF;
END //

DROP PROCEDURE IF EXISTS ytr_exec_if_col_exists //
CREATE PROCEDURE ytr_exec_if_col_exists(IN p_table VARCHAR(64), IN p_col VARCHAR(64), IN p_sql TEXT)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND column_name = p_col
  ) THEN
    CALL ytr_exec_sql(p_sql);
  END IF;
END //

DROP PROCEDURE IF EXISTS ytr_exec_if_index_missing //
CREATE PROCEDURE ytr_exec_if_index_missing(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_sql TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND index_name = p_index
  ) THEN
    CALL ytr_exec_sql(p_sql);
  END IF;
END //

DELIMITER ;

-- ------------------------------------------------------------------
-- artists: legacy columns name/origin -> artist/country
-- ------------------------------------------------------------------
CALL ytr_exec_if_col_missing('artists', 'artist', 'ALTER TABLE artists ADD COLUMN artist VARCHAR(255) NULL');
CALL ytr_exec_if_col_missing('artists', 'country', 'ALTER TABLE artists ADD COLUMN country VARCHAR(255) NULL');
CALL ytr_exec_if_col_exists('artists', 'name', 'UPDATE artists SET artist = COALESCE(artist, name) WHERE artist IS NULL');
CALL ytr_exec_if_col_exists('artists', 'origin', 'UPDATE artists SET country = COALESCE(country, origin) WHERE country IS NULL');
UPDATE artists SET artist = CONCAT('Unknown Artist ', id) WHERE artist IS NULL OR TRIM(artist) = '';
ALTER TABLE artists MODIFY artist VARCHAR(255) NOT NULL;

-- ------------------------------------------------------------------
-- genres: add slug expected by seed and current app behavior
-- ------------------------------------------------------------------
CALL ytr_exec_if_col_missing('genres', 'slug', 'ALTER TABLE genres ADD COLUMN slug VARCHAR(255) NULL');
UPDATE genres
SET slug = LOWER(
  TRIM(BOTH '-' FROM REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-'), '-+', '-'))
)
WHERE slug IS NULL OR TRIM(slug) = '';

-- ------------------------------------------------------------------
-- messages: legacy userid/type/videoId/message -> user_id/room/video_id/content/created_at
-- ------------------------------------------------------------------
CALL ytr_exec_if_col_missing('messages', 'user_id', 'ALTER TABLE messages ADD COLUMN user_id INT NULL');
CALL ytr_exec_if_col_missing('messages', 'room', 'ALTER TABLE messages ADD COLUMN room VARCHAR(50) NULL');
CALL ytr_exec_if_col_missing('messages', 'video_id', 'ALTER TABLE messages ADD COLUMN video_id VARCHAR(32) NULL');
CALL ytr_exec_if_col_missing('messages', 'content', 'ALTER TABLE messages ADD COLUMN content TEXT NULL');
CALL ytr_exec_if_col_missing('messages', 'created_at', 'ALTER TABLE messages ADD COLUMN created_at DATETIME NULL');

CALL ytr_exec_if_col_exists('messages', 'userid', 'UPDATE messages SET user_id = COALESCE(user_id, userid)');
CALL ytr_exec_if_col_exists('messages', 'type', 'UPDATE messages SET room = COALESCE(room, type)');
CALL ytr_exec_if_col_exists('messages', 'videoId', 'UPDATE messages SET video_id = COALESCE(video_id, videoId)');
CALL ytr_exec_if_col_exists('messages', 'message', 'UPDATE messages SET content = COALESCE(content, message)');
CALL ytr_exec_if_col_exists('messages', 'createdAt', 'UPDATE messages SET created_at = COALESCE(created_at, createdAt)');

UPDATE messages SET content = '' WHERE content IS NULL;
ALTER TABLE messages MODIFY content TEXT NOT NULL;

-- ------------------------------------------------------------------
-- playlistnames: add user_id/is_private expected by Prisma
-- ------------------------------------------------------------------
CALL ytr_exec_if_col_missing('playlistnames', 'user_id', 'ALTER TABLE playlistnames ADD COLUMN user_id INT NULL');
CALL ytr_exec_if_col_missing('playlistnames', 'is_private', 'ALTER TABLE playlistnames ADD COLUMN is_private TINYINT(1) NULL DEFAULT 0');

-- ------------------------------------------------------------------
-- playlistitems: legacy playlistId/videoId(varchar) -> playlist_id/video_id(int fk to videos.id)
-- ------------------------------------------------------------------
CALL ytr_exec_if_col_missing('playlistitems', 'playlist_id', 'ALTER TABLE playlistitems ADD COLUMN playlist_id INT NULL');
CALL ytr_exec_if_col_missing('playlistitems', 'video_id', 'ALTER TABLE playlistitems ADD COLUMN video_id INT NULL');
CALL ytr_exec_if_col_missing('playlistitems', 'sort_order', 'ALTER TABLE playlistitems ADD COLUMN sort_order INT NULL');

CALL ytr_exec_if_col_exists('playlistitems', 'playlistId', 'UPDATE playlistitems SET playlist_id = COALESCE(playlist_id, playlistId)');

-- Ensure there is a fallback playlist for any orphan rows.
INSERT INTO playlistnames (name, user_id, is_private)
SELECT 'Recovered Playlist Items', NULL, 1
WHERE NOT EXISTS (
  SELECT 1 FROM playlistnames WHERE name = 'Recovered Playlist Items'
);

SET @recovered_playlist_id = (
  SELECT id FROM playlistnames WHERE name = 'Recovered Playlist Items' ORDER BY id LIMIT 1
);
UPDATE playlistitems SET playlist_id = @recovered_playlist_id WHERE playlist_id IS NULL;

-- Create placeholder videos for any playlist row whose legacy string videoId is unknown.
CALL ytr_exec_if_col_exists(
  'playlistitems',
  'videoId',
  'INSERT INTO videos (videoId, title, favourited, created_at, updated_at)
   SELECT DISTINCT pi.videoId, CONCAT(''Recovered video '', pi.videoId), 0, NOW(), NOW()
   FROM playlistitems pi
   LEFT JOIN videos v ON v.videoId = pi.videoId
   WHERE pi.videoId IS NOT NULL AND pi.video_id IS NULL AND v.id IS NULL'
);

-- Handle rows with NULL legacy videoId by generating deterministic placeholder ids.
INSERT INTO videos (videoId, title, favourited, created_at, updated_at)
SELECT CONCAT('legacy-', LPAD(pi.id, 10, '0')), CONCAT('Recovered playlist item ', pi.id), 0, NOW(), NOW()
FROM playlistitems pi
LEFT JOIN videos v ON v.videoId = CONCAT('legacy-', LPAD(pi.id, 10, '0'))
WHERE pi.video_id IS NULL AND v.id IS NULL;

CALL ytr_exec_if_col_exists(
  'playlistitems',
  'videoId',
  'UPDATE playlistitems pi
   JOIN videos v ON v.videoId = pi.videoId
   SET pi.video_id = v.id
   WHERE pi.video_id IS NULL AND pi.videoId IS NOT NULL'
);

UPDATE playlistitems pi
JOIN videos v ON v.videoId = CONCAT('legacy-', LPAD(pi.id, 10, '0'))
SET pi.video_id = v.id
WHERE pi.video_id IS NULL;

ALTER TABLE playlistitems MODIFY playlist_id INT NOT NULL;
ALTER TABLE playlistitems MODIFY video_id INT NOT NULL;

-- ------------------------------------------------------------------
-- watch_history: ensure canonical table/columns exist
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  video_id VARCHAR(32) NOT NULL,
  watch_count INT NOT NULL DEFAULT 0,
  first_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_position_sec INT NOT NULL DEFAULT 0,
  last_duration_sec INT NOT NULL DEFAULT 0,
  max_progress_percent FLOAT NOT NULL DEFAULT 0,
  UNIQUE KEY watch_history_user_video_unique (user_id, video_id),
  KEY watch_history_user_last_watched_idx (user_id, last_watched_at),
  KEY watch_history_video_idx (video_id)
);

CALL ytr_exec_if_col_missing('watch_history', 'watch_count', 'ALTER TABLE watch_history ADD COLUMN watch_count INT NOT NULL DEFAULT 0');
CALL ytr_exec_if_col_missing('watch_history', 'first_watched_at', 'ALTER TABLE watch_history ADD COLUMN first_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL ytr_exec_if_col_missing('watch_history', 'last_watched_at', 'ALTER TABLE watch_history ADD COLUMN last_watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
CALL ytr_exec_if_col_missing('watch_history', 'last_position_sec', 'ALTER TABLE watch_history ADD COLUMN last_position_sec INT NOT NULL DEFAULT 0');
CALL ytr_exec_if_col_missing('watch_history', 'last_duration_sec', 'ALTER TABLE watch_history ADD COLUMN last_duration_sec INT NOT NULL DEFAULT 0');
CALL ytr_exec_if_col_missing('watch_history', 'max_progress_percent', 'ALTER TABLE watch_history ADD COLUMN max_progress_percent FLOAT NOT NULL DEFAULT 0');

UPDATE watch_history SET watch_count = 0 WHERE watch_count IS NULL;
UPDATE watch_history SET first_watched_at = NOW() WHERE first_watched_at IS NULL;
UPDATE watch_history SET last_watched_at = NOW() WHERE last_watched_at IS NULL;
UPDATE watch_history SET last_position_sec = 0 WHERE last_position_sec IS NULL;
UPDATE watch_history SET last_duration_sec = 0 WHERE last_duration_sec IS NULL;
UPDATE watch_history SET max_progress_percent = 0 WHERE max_progress_percent IS NULL;

DELETE FROM watch_history WHERE user_id IS NULL OR video_id IS NULL;

CALL ytr_exec_if_index_missing('watch_history', 'watch_history_user_video_unique', 'ALTER TABLE watch_history ADD UNIQUE KEY watch_history_user_video_unique (user_id, video_id)');
CALL ytr_exec_if_index_missing('watch_history', 'watch_history_user_last_watched_idx', 'ALTER TABLE watch_history ADD KEY watch_history_user_last_watched_idx (user_id, last_watched_at)');
CALL ytr_exec_if_index_missing('watch_history', 'watch_history_video_idx', 'ALTER TABLE watch_history ADD KEY watch_history_video_idx (video_id)');

-- ------------------------------------------------------------------
-- Cleanup helper procedures
-- ------------------------------------------------------------------
DROP PROCEDURE IF EXISTS ytr_exec_if_index_missing;
DROP PROCEDURE IF EXISTS ytr_exec_if_col_exists;
DROP PROCEDURE IF EXISTS ytr_exec_if_col_missing;
DROP PROCEDURE IF EXISTS ytr_exec_sql;

COMMIT;
