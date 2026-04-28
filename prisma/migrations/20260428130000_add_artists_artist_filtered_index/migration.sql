-- Add index on artists.artist for non-null values
-- HOTSPOT 2 FIX: Artist lookup queries with WHERE artist IS NOT NULL were doing full table scans
-- Creating an index on artist column dramatically speeds up:
-- - findArtistsInDatabase() with empty search (returns all artists)
-- - Artist listing/browsing by name  
-- - Artist statistics aggregation
-- - Category/genre browsing that pulls artists

CREATE INDEX idx_artists_artist ON artists(artist);
