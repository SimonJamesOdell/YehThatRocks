-- Enforce uniqueness on (userid, videoId) in the favourites table.
--
-- The updateFavourite() function historically used a check-then-insert pattern
-- (findFirst -> create), which races under concurrent requests and can produce
-- duplicate rows for the same (userid, videoId) pair. Step 1 removes any
-- existing duplicates (keeping the lowest id), then step 2 adds a unique index
-- so duplicates cannot recur.

-- 1. Deduplicate: keep the lowest-id row per (userid, videoId) pair.
DELETE f1 FROM favourites f1
INNER JOIN favourites f2
  ON f1.userid = f2.userid
 AND f1.videoId = f2.videoId
 AND f1.id > f2.id;

-- 2. Enforce uniqueness at the database level.
ALTER TABLE favourites
  ADD UNIQUE INDEX uq_favourite_user_video (userid, videoId);
