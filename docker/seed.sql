-- Bootstrap the yeh database with seed data so the app has something to show.
-- Prisma db push (run by entrypoint.sh) creates the schema; this file seeds data.

-- Sample genres
INSERT IGNORE INTO genres (id, name, slug) VALUES
  (1, 'Alternative', 'alternative'),
  (2, 'Black Metal', 'black-metal'),
  (3, 'Death Metal', 'death-metal'),
  (4, 'Doom', 'doom'),
  (5, 'Gothic', 'gothic'),
  (6, 'Industrial', 'industrial'),
  (7, 'Metalcore', 'metalcore'),
  (8, 'Nu Metal', 'nu-metal'),
  (9, 'Power Metal', 'power-metal'),
  (10, 'Progressive Metal', 'progressive-metal'),
  (11, 'Symphonic Metal', 'symphonic-metal'),
  (12, 'Thrash Metal', 'thrash-metal');

-- Sample videos (YouTube IDs from the seed catalog)
INSERT IGNORE INTO videos (videoId, title, channelTitle, favourited, description) VALUES
  ('3YxaaGgTQYM', 'Evanescence - Bring Me To Life', 'Evanescence', 9821, 'Gothic Metal classic'),
  ('v-Su1YXQYek', 'Mastodon - Blood and Thunder', 'Mastodon', 8644, 'Sludge Metal'),
  ('SU1apJTv94o', 'Gojira - Stranded', 'Gojira', 8120, 'Progressive Groove Metal'),
  ('47e_961OQWE', 'Nightwish - Ghost Love Score', 'Nightwish', 7784, 'Symphonic Metal epic'),
  ('iPW9AbRMwFU', 'Killswitch Engage - My Curse', 'Killswitch Engage', 7422, 'Metalcore');

-- Mark seeded videos as available via site_videos
INSERT IGNORE INTO site_videos (video_id, title, status, created_at)
SELECT v.id, v.title, 'available', NOW()
FROM videos v
WHERE v.videoId IN ('3YxaaGgTQYM', 'v-Su1YXQYek', 'SU1apJTv94o', '47e_961OQWE', 'iPW9AbRMwFU');

-- Sample artists
INSERT IGNORE INTO artists (artist, country, genre1) VALUES
  ('Gojira', 'France', 'Progressive Metal'),
  ('Mastodon', 'United States', 'Sludge Metal'),
  ('Nightwish', 'Finland', 'Symphonic Metal'),
  ('Evanescence', 'United States', 'Gothic Metal'),
  ('Killswitch Engage', 'United States', 'Metalcore');

-- Add legacy 'views' column expected by raw SQL queries in catalog-data.ts
-- MySQL 8.0 lacks ADD COLUMN IF NOT EXISTS, so we check via a procedure.
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'videos' AND column_name = 'views');
SET @stmt = IF(@col_exists = 0, 'ALTER TABLE videos ADD COLUMN views INT DEFAULT 0', 'SELECT 1');
PREPARE alter_stmt FROM @stmt;
EXECUTE alter_stmt;
DEALLOCATE PREPARE alter_stmt;

-- Backfill legacy views from viewCount only on first-time column creation.
-- This avoids repeating a large write/update scan on every container restart.
SET @backfill_stmt = IF(
  @col_exists = 0,
  'UPDATE videos SET views = COALESCE(viewCount, 0) WHERE views = 0 OR views IS NULL',
  'SELECT 1'
);
PREPARE backfill_stmt FROM @backfill_stmt;
EXECUTE backfill_stmt;
DEALLOCATE PREPARE backfill_stmt;
