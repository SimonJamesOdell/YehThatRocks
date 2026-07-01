-- Add slug column to forum_threads for SEO-friendly URLs
ALTER TABLE forum_threads
  ADD COLUMN slug VARCHAR(300) NULL,
  ADD UNIQUE INDEX idx_forum_threads_slug (slug);

-- Generate slugs for existing threads (lowercase, hyphenated, alphanumeric, truncated)
-- Pattern: sanitized-title-prefix + '-' + id
UPDATE forum_threads
SET slug = CONCAT(
  LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(title, '[^a-zA-Z0-9\\s-]', ''),
        '\\s+', '-'
      ),
      '-+', '-'
    )
  ),
  '-',
  id
)
WHERE slug IS NULL;
