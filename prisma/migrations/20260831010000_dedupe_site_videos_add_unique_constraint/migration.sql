-- Deduplicate site_videos and enforce a UNIQUE constraint on video_id.
--
-- The unavailable report route and ingestion writers historically inserted
-- one site_videos row per (video_id, status) event, so a single video could
-- accumulate both `available` and `check-failed` rows. createMany with
-- skipDuplicates only dedupes against a unique index, which did not exist,
-- so duplicates were free to recur.
--
-- Step 1 keeps a single canonical row per video_id (highest precedence wins):
--   available > check-failed > unavailable > NULL
-- and lowest id breaks ties. Rows with NULL video_id are left untouched
-- (a MySQL UNIQUE index allows multiple NULLs).
--
-- Step 2 adds the unique index so duplicates cannot recur.

-- 1. Delete non-canonical duplicate rows per video_id.
DELETE sv FROM site_videos sv
INNER JOIN (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY video_id
           ORDER BY
             CASE status
               WHEN 'available' THEN 1
               WHEN 'check-failed' THEN 2
               WHEN 'unavailable' THEN 3
               ELSE 4
             END,
             id ASC
         ) AS rn
  FROM site_videos
  WHERE video_id IS NOT NULL
) ranked ON ranked.id = sv.id AND ranked.rn > 1;

-- 2. Enforce uniqueness at the database level.
ALTER TABLE site_videos
  ADD UNIQUE INDEX site_videos_video_id_key (video_id);
