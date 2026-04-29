-- Materialize site_videos availability per video_id so hotspot queries can
-- join one summary row instead of rebuilding DISTINCT availability sets.

CREATE TABLE IF NOT EXISTS site_video_availability_summary (
  video_id INT NOT NULL,
  available_count INT NOT NULL DEFAULT 0,
  blocked_count INT NOT NULL DEFAULT 0,
  has_available TINYINT(1) AS (CASE WHEN available_count > 0 THEN 1 ELSE 0 END) STORED,
  has_blocked TINYINT(1) AS (CASE WHEN blocked_count > 0 THEN 1 ELSE 0 END) STORED,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (video_id),
  CONSTRAINT fk_site_video_availability_summary_video
    FOREIGN KEY (video_id) REFERENCES videos(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

INSERT INTO site_video_availability_summary (video_id, available_count, blocked_count)
SELECT
  sv.video_id,
  COALESCE(SUM(CASE WHEN sv.status = 'available' THEN 1 ELSE 0 END), 0) AS available_count,
  COALESCE(SUM(CASE WHEN sv.status IS NULL OR sv.status <> 'available' THEN 1 ELSE 0 END), 0) AS blocked_count
FROM site_videos sv
WHERE sv.video_id IS NOT NULL
GROUP BY sv.video_id
ON DUPLICATE KEY UPDATE
  available_count = VALUES(available_count),
  blocked_count = VALUES(blocked_count),
  updated_at = CURRENT_TIMESTAMP;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'site_video_availability_summary'
    AND index_name = 'idx_site_video_availability_summary_available_video'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_site_video_availability_summary_available_video ON site_video_availability_summary (has_available, video_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TRIGGER IF EXISTS trg_site_videos_summary_ai;
CREATE TRIGGER trg_site_videos_summary_ai
AFTER INSERT ON site_videos
FOR EACH ROW
REPLACE INTO site_video_availability_summary (video_id, available_count, blocked_count)
SELECT
  t.video_id,
  COALESCE(SUM(CASE WHEN sv.status = 'available' THEN 1 ELSE 0 END), 0) AS available_count,
  COALESCE(SUM(CASE WHEN sv.status IS NULL OR sv.status <> 'available' THEN 1 ELSE 0 END), 0) AS blocked_count
FROM (SELECT NEW.video_id AS video_id) t
LEFT JOIN site_videos sv ON sv.video_id = t.video_id
WHERE t.video_id IS NOT NULL
GROUP BY t.video_id;

DROP TRIGGER IF EXISTS trg_site_videos_summary_ad;
CREATE TRIGGER trg_site_videos_summary_ad
AFTER DELETE ON site_videos
FOR EACH ROW
REPLACE INTO site_video_availability_summary (video_id, available_count, blocked_count)
SELECT
  t.video_id,
  COALESCE(SUM(CASE WHEN sv.status = 'available' THEN 1 ELSE 0 END), 0) AS available_count,
  COALESCE(SUM(CASE WHEN sv.status IS NULL OR sv.status <> 'available' THEN 1 ELSE 0 END), 0) AS blocked_count
FROM (SELECT OLD.video_id AS video_id) t
LEFT JOIN site_videos sv ON sv.video_id = t.video_id
WHERE t.video_id IS NOT NULL
GROUP BY t.video_id;

DROP TRIGGER IF EXISTS trg_site_videos_summary_au;
CREATE TRIGGER trg_site_videos_summary_au
AFTER UPDATE ON site_videos
FOR EACH ROW
REPLACE INTO site_video_availability_summary (video_id, available_count, blocked_count)
SELECT
  t.video_id,
  COALESCE(SUM(CASE WHEN sv.status = 'available' THEN 1 ELSE 0 END), 0) AS available_count,
  COALESCE(SUM(CASE WHEN sv.status IS NULL OR sv.status <> 'available' THEN 1 ELSE 0 END), 0) AS blocked_count
FROM (
  SELECT OLD.video_id AS video_id
  UNION
  SELECT NEW.video_id AS video_id
) t
LEFT JOIN site_videos sv ON sv.video_id = t.video_id
WHERE t.video_id IS NOT NULL
GROUP BY t.video_id;