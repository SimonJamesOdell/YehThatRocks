-- Rewrite magazine article slugs from old date-hash format to clean readable format
-- e.g., artist-track-20260510-e4bc55 -> artist-track

-- Step 1: Create temporary table to hold mapping of old -> new slugs
CREATE TEMPORARY TABLE IF NOT EXISTS slug_mapping (
  id INT AUTO_INCREMENT PRIMARY KEY,
  old_slug VARCHAR(255) NOT NULL UNIQUE,
  base_slug VARCHAR(255) NOT NULL,
  final_slug VARCHAR(255) NOT NULL
);

-- Step 2: Generate clean base slugs from artist + track
-- Clean slug = lowercase(artist-track), removing special characters
INSERT INTO slug_mapping (old_slug, base_slug, final_slug)
SELECT
  ma.slug,
  LOWER(REPLACE(REPLACE(REPLACE(TRIM(CONCAT_WS('-', ma.artist, COALESCE(ma.track_name, ''))), ' ', '-'), "'", ''), '--', '-')),
  LOWER(REPLACE(REPLACE(REPLACE(TRIM(CONCAT_WS('-', ma.artist, COALESCE(ma.track_name, ''))), ' ', '-'), "'", ''), '--', '-'))
FROM magazine_articles ma
WHERE ma.status = 'published'
ORDER BY ma.id;

-- Step 3: Detect and handle collisions
-- MariaDB cannot reopen the same temporary table multiple times in one UPDATE,
-- so compute per-base_slug occurrence ranks in a second temporary table first.
CREATE TEMPORARY TABLE IF NOT EXISTS slug_occurrence (
  id INT PRIMARY KEY,
  occurrence INT NOT NULL
);

INSERT INTO slug_occurrence (id, occurrence)
SELECT ranked.id, ranked.occurrence
FROM (
  SELECT
    sm.id,
    @occurrence := IF(@current_base = sm.base_slug, @occurrence + 1, 1) AS occurrence,
    @current_base := sm.base_slug AS _current_base
  FROM slug_mapping sm
  JOIN (SELECT @current_base := '', @occurrence := 0) vars
  ORDER BY sm.base_slug, sm.id
) AS ranked;

UPDATE slug_mapping sm
INNER JOIN slug_occurrence so ON so.id = sm.id
SET sm.final_slug = CASE
  WHEN so.occurrence = 1 THEN sm.base_slug
  ELSE CONCAT(sm.base_slug, '-', so.occurrence)
END;

-- Step 4: Update magazine_articles with new slugs
UPDATE magazine_articles ma
INNER JOIN slug_mapping sm ON ma.slug = sm.old_slug
SET ma.slug = sm.final_slug,
    ma.updated_at = NOW(3)
WHERE ma.status = 'published';

-- Step 5: Update magazine_article_external_landings to point to new slugs
UPDATE magazine_article_external_landings mal
INNER JOIN slug_mapping sm ON mal.article_slug = sm.old_slug
SET mal.article_slug = sm.final_slug
WHERE 1=1;

-- Step 6: Clean up
DROP TEMPORARY TABLE IF EXISTS slug_occurrence;
DROP TEMPORARY TABLE IF EXISTS slug_mapping;
