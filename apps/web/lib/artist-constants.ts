/**
 * artist-constants.ts
 * Cache/query constants extracted from catalog-data-artists.ts.
 */

export const ARTIST_NORM_VIDEO_POOL_CACHE_TTL_MS = 30 * 60 * 1000;
export const ARTIST_NORM_VIDEO_POOL_MIN_ROWS = 72;
export const ARTIST_NORM_VIDEO_POOL_HEADROOM_ROWS = 18;
export const ARTIST_NORM_VIDEO_POOL_MAX_ROWS = 180;
export const SAME_GENRE_RELATED_POOL_CACHE_TTL_MS = 5 * 60 * 1000;
export const ARTIST_LETTER_CACHE_TTL_MS = 10 * 60 * 1000;
export const ARTIST_LETTER_PAGE_CACHE_TTL_MS = 60_000;
export const ARTIST_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
export const ARTIST_STATS_LETTER_BACKFILL_TTL_MS = 10 * 60 * 1000;
export const ARTIST_PROJECTION_REFRESH_TTL_MS = 5 * 60 * 1000;
export const ARTISTS_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
export const ARTIST_SLUG_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
export const ARTIST_SINGLE_SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
export const ARTIST_VIDEOS_CACHE_TTL_MS = 20_000;
export const ARTIST_VIDEO_METADATA_SEARCH_CACHE_TTL_MS = 60_000;
export const KNOWN_ARTIST_MATCH_CACHE_TTL_MS = 10 * 60 * 1000;
export const ARTIST_CATALOG_EVIDENCE_CACHE_TTL_MS = 10 * 60 * 1000;
export const ARTIST_CACHE_MAX_ENTRIES = Math.max(
  200,
  Math.min(10_000, Number(process.env.ARTIST_CACHE_MAX_ENTRIES || "1200")),
);
export const ARTIST_HEAVY_CACHE_MAX_ENTRIES = Math.max(
  120,
  Math.min(2_000, Number(process.env.ARTIST_HEAVY_CACHE_MAX_ENTRIES || "220")),
);
