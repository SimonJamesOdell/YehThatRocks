import type { RankedVideoRow } from "@/lib/catalog-data-utils";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Number of top-ranked videos to draw from for weighted selection. */
export const WEIGHTED_POOL_SIZE = 200;

/** Minimum decay multiplier applied to the most-recently-played video's weight. */
export const RECENT_DECAY_BASE = 0.1;

/** Maximum decay multiplier (closest to 1.0) for the oldest entry in the recent list. */
export const RECENT_DECAY_MAX = 0.9;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Select a random index from the pool using weighted probabilities.
 *
 * ## Weighting algorithm
 *
 * **Base weight:** `(1 + ln(1 + favourited)) × (1 + ln(1 + viewCount))`
 *   — Dampened logarithmic scaling so engagement matters but doesn't dominate.
 *   A video with 100 favs + 10,000 views gets roughly 3× the weight of a
 *   video with 0 favs + 0 views, not 100×.
 *
 * **Recency decay:** If a video appears in `recentVideoIds` (ordered
 *   most-recent-first), its weight is multiplied by a factor that scales
 *   linearly from `RECENT_DECAY_BASE` (most recent) to `RECENT_DECAY_MAX`
 *   (oldest entry in the list). Recently-played tracks become less likely
 *   without being excluded entirely.
 *
 * **Deterministic given Math.random:** If you control `Math.random`, results
 *   are fully deterministic.
 *
 * @param pool      Array of ranked video rows (must be non-empty for a valid result).
 * @param recentVideoIds  Recently-played video IDs, most-recent-first.
 * @returns         Index into `pool`, or -1 if pool is empty.
 */
export function weightedRandomSelect(
  pool: RankedVideoRow[],
  recentVideoIds: string[],
): number {
  if (pool.length === 0) return -1;

  const recentIndexByVideoId = new Map<string, number>();
  recentVideoIds.forEach((videoId, index) => {
    recentIndexByVideoId.set(videoId, index);
  });

  const recentCount = Math.max(recentVideoIds.length, 1);
  const weights: number[] = new Array(pool.length);
  let totalWeight = 0;

  for (let i = 0; i < pool.length; i++) {
    const video = pool[i];
    const fav = video.favourited ?? 0;
    const views = video.viewCount ?? 0;

    // Dampened logarithmic engagement weight — popular videos get a boost but
    // don't swamp the pool.
    const baseWeight = (1 + Math.log(1 + fav)) * (1 + Math.log(1 + views));

    let weight = baseWeight;

    const recentIndex = recentIndexByVideoId.get(video.videoId);
    if (recentIndex !== undefined) {
      // Scale from RECENT_DECAY_BASE (most recent) to RECENT_DECAY_MAX (oldest in list).
      // When there's only one entry, clamp to RECENT_DECAY_BASE.
      const t = recentCount > 1 ? recentIndex / (recentCount - 1) : 0;
      const decay = RECENT_DECAY_BASE + (RECENT_DECAY_MAX - RECENT_DECAY_BASE) * t;
      weight *= decay;
    }

    weights[i] = weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return 0;

  const random = Math.random() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (random <= cumulative) {
      return i;
    }
  }

  return pool.length - 1;
}
