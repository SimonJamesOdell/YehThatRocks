-- VPS data migration: populate rejected_videos from the existing videos/site_videos tables,
-- then clean out the dead rows from videos (and their site_videos entries).
--
-- Run this AFTER deploying the app code and after `prisma migrate deploy` has created
-- the rejected_videos table. Run on the VPS via:
--   mysql -u <user> -p yeh < scripts/migrate-rejected-videos-vps.sql
--
-- Idempotent: INSERT IGNORE / ON DUPLICATE KEY means it is safe to re-run.
--
-- Step 1: Capture all unavailable videos into rejected_videos.
-- We use the site_videos.status as the rejection reason (e.g. 'unavailable').
-- 'check-failed' videos are also captured — the embed check for these genuinely failed
-- (age-restricted, deleted, etc.) and they should not be retried automatically.

INSERT IGNORE INTO rejected_videos (video_id, reason, rejected_at)
SELECT
  v.videoId            AS video_id,
  sv.status            AS reason,
  COALESCE(sv.created_at, v.created_at, NOW()) AS rejected_at
FROM videos v
INNER JOIN site_videos sv ON sv.video_id = v.id
WHERE sv.status IN ('unavailable', 'check-failed')
  AND v.videoId IS NOT NULL;

-- Step 2: Capture orphaned videos (in videos but no site_videos entry).
-- These were ingested but never got an availability record. Treat as unknown/orphaned.

INSERT IGNORE INTO rejected_videos (video_id, reason, rejected_at)
SELECT
  v.videoId       AS video_id,
  'orphaned'      AS reason,
  COALESCE(v.created_at, NOW()) AS rejected_at
FROM videos v
WHERE NOT EXISTS (
  SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id
)
  AND v.videoId IS NOT NULL;

-- Step 3: Delete site_videos entries for all non-available videos.
-- (available site_videos entries are kept — those videos remain in the main videos table.)

DELETE sv
FROM site_videos sv
INNER JOIN videos v ON v.id = sv.video_id
WHERE sv.status IN ('unavailable', 'check-failed');

-- Step 4: Delete orphaned site_videos entries (sanity clean-up, no video row).

DELETE sv
FROM site_videos sv
WHERE sv.video_id NOT IN (SELECT id FROM videos);

-- Step 5: Delete playlist items that still point at videos with no available site_videos row.
-- These rows would otherwise block the videos delete because playlistitems.video_id
-- has an ON DELETE RESTRICT foreign key to videos.id.

DELETE pi
FROM playlistitems pi
INNER JOIN videos v ON v.id = pi.video_id
WHERE NOT EXISTS (
  SELECT 1
  FROM site_videos sv
  WHERE sv.video_id = v.id
    AND sv.status = 'available'
);

-- Step 6: Delete artist-video links that still point at videos with no available site_videos row.
-- This keeps videosbyartist consistent before the parent videos rows are removed.

DELETE va
FROM videosbyartist va
INNER JOIN videos v ON v.id = va.video_id
WHERE NOT EXISTS (
  SELECT 1
  FROM site_videos sv
  WHERE sv.video_id = v.id
    AND sv.status = 'available'
);

-- Step 7: Delete from videos all rows that now have NO available site_videos entry.
-- This removes: unavailable, check-failed, and orphaned rows captured above.
-- Videos with status='available' in site_videos are NOT touched.

DELETE v
FROM videos v
WHERE NOT EXISTS (
  SELECT 1
  FROM site_videos sv
  WHERE sv.video_id = v.id
    AND sv.status = 'available'
);

-- Verification queries (run manually to confirm results):
-- SELECT COUNT(*) FROM videos;                   -- should be ~68k
-- SELECT COUNT(*) FROM rejected_videos;          -- should be ~198k
-- SELECT COUNT(*) FROM site_videos;              -- should be ~68k (available only)
-- SELECT DISTINCT status FROM site_videos;       -- should only contain 'available'
