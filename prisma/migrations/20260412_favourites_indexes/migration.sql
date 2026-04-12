-- Improve favourites lookup performance at scale.
-- 1) User-specific favourites queries (WHERE userid = ?)
-- 2) Video favourite count queries (WHERE videoId = ?)
ALTER TABLE favourites
  ADD INDEX idx_favourites_userid_videoid (userid, videoId),
  ADD INDEX idx_favourites_videoid (videoId);
