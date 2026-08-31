-- Normalize genre_cards to the Prisma default collation (utf8mb4_unicode_ci).
--
-- genre_cards was created with MySQL 8's default collation (utf8mb4_0900_ai_ci),
-- which differs from the Prisma default used by every other table (including
-- analytics_events). Cross-table JOINs against videos.videoId therefore raised
-- "Illegal mix of collations". CONVERT TO rewrites both the table default and
-- its string columns (genre, thumbnail_video_id) to utf8mb4_unicode_ci.

ALTER TABLE genre_cards CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
