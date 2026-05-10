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
-- For each base_slug that appears more than once, append numeric suffixes
UPDATE slug_mapping sm
SET final_slug = CONCAT(base_slug, '-', (SELECT COUNT(*) FROM slug_mapping sm2 WHERE sm2.base_slug = sm.base_slug AND sm2.id < sm.id) + 2)
WHERE base_slug IN (
  SELECT base_slug FROM slug_mapping GROUP BY base_slug HAVING COUNT(*) > 1
) AND id > (SELECT MIN(id) FROM slug_mapping sm2 WHERE sm2.base_slug = sm.base_slug);

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
DROP TEMPORARY TABLE IF EXISTS slug_mapping;
