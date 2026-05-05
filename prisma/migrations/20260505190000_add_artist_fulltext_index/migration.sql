-- CreateIndex: FULLTEXT index on artists.artist for slug resolution
-- Replaces the runtime CREATE INDEX in ensureArtistFulltextIndex().
-- Enables MATCH(artist) AGAINST('+term*' IN BOOLEAN MODE) in getArtistBySlug,
-- eliminating the LOWER(artist) LIKE '%term%' full-table scan (~0.75s per call).
CREATE FULLTEXT INDEX `idx_artists_artist_fulltext` ON `artists`(`artist`);
