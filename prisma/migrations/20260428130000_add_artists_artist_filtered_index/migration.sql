-- Add index on artists.artist for non-null values
-- HOTSPOT 2 FIX: Artist lookup queries with WHERE artist IS NOT NULL were doing full table scans
-- Creating an index on artist column dramatically speeds up:
-- - findArtistsInDatabase() with empty search (returns all artists)
-- - Artist listing/browsing by name  
-- - Artist statistics aggregation
-- - Category/genre browsing that pulls artists

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'artists'
    AND index_name = 'idx_artists_artist'
);
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_artists_artist ON artists(artist)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
