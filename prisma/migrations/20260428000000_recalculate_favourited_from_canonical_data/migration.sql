-- Recalculate videos.favourited from the canonical favourites table.
-- The column previously contained legacy imported counts that did not
-- reflect real user activity. This sets each video's count to the true
-- number of distinct users who have favourited it.
UPDATE videos v
SET v.favourited = (
  SELECT COUNT(DISTINCT f.userid)
  FROM favourites f
  WHERE f.videoId = v.videoId
);
