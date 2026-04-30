-- Restore test favourites data for system verification
-- First, get list of high-favourited videos into temp table
CREATE TEMPORARY TABLE temp_favvids AS
SELECT videoId FROM videos WHERE favourited > 0 ORDER BY favourited DESC LIMIT 12;

INSERT INTO favourites (userid, videoId, createdAt, updatedAt) 
SELECT u.id, t.videoId, NOW(), NOW()
FROM users u
CROSS JOIN temp_favvids t
WHERE u.id >= 17 AND u.id <= 22;

DROP TEMPORARY TABLE temp_favvids;

SELECT ROW_COUNT() AS inserted;
SELECT COUNT(*) as total_favs FROM favourites;
SELECT userid, COUNT(*) as user_fav_count FROM favourites GROUP BY userid;
