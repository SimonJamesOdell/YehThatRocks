/**
 * video-constants.ts
 * Cache/query constants extracted from catalog-data-videos.ts.
 */

export const TOP_POOL_CACHE_TTL_MS = 5 * 60 * 1000;
export const MIN_RANKED_TOP_POOL_FETCH = 200;
export const RANKED_VIDEO_ID_SLICE_CACHE_TTL_MS = Math.max(
  15_000,
  Math.min(60_000, Number(process.env.RANKED_VIDEO_ID_SLICE_CACHE_TTL_MS || "30000")),
);
