/**
 * catalog-data-favourites.ts
 * Favourite videos domain: cache, load, and persist user favourite video lists.
 */

import { prisma } from "@/lib/db";
import { createFavouriteVideosCache } from "@/lib/favourite-videos-cache";
import type { VideoRecord } from "@/lib/catalog";
import { hasDatabaseUrl, mapVideo, normalizeYouTubeVideoId } from "@/lib/catalog-data-utils";
import { pruneMapToMaxEntries } from "@/lib/bounded-map";

// ── Constants & caches ────────────────────────────────────────────────────────

export const FAVOURITE_VIDEOS_CACHE_TTL_MS = 20_000;
export const USER_SCOPED_CACHE_MAX_ENTRIES = Math.max(
  100,
  Math.min(10_000, Number(process.env.USER_SCOPED_CACHE_MAX_ENTRIES || "1500")),
);

const favouriteVideosCache = createFavouriteVideosCache(FAVOURITE_VIDEOS_CACHE_TTL_MS, {
  maxEntries: USER_SCOPED_CACHE_MAX_ENTRIES,
});
const favouriteVideosInFlight = new Map<number, Promise<VideoRecord[]>>();

const FAVOURITE_VIDEOS_METRICS_LOG_INTERVAL_MS = 60_000;
const FAVOURITE_VIDEOS_METRICS_LOG_EVERY_LOOKUPS = 250;
const favouriteVideosCacheMetrics = {
  lookups: 0,
  hits: 0,
  misses: 0,
  inFlightReuses: 0,
  dbLoads: 0,
  dbErrors: 0,
  forceRefreshes: 0,
  lastLoggedAt: 0,
};

// ── Metrics ───────────────────────────────────────────────────────────────────

function markFavouriteVideosCacheMetric(
  event: "hit" | "miss" | "inflight-reuse" | "db-load" | "db-error" | "force-refresh",
) {
  if (event === "hit" || event === "miss" || event === "inflight-reuse") {
    favouriteVideosCacheMetrics.lookups += 1;
  }

  switch (event) {
    case "hit":
      favouriteVideosCacheMetrics.hits += 1;
      break;
    case "miss":
      favouriteVideosCacheMetrics.misses += 1;
      break;
    case "inflight-reuse":
      favouriteVideosCacheMetrics.inFlightReuses += 1;
      break;
    case "db-load":
      favouriteVideosCacheMetrics.dbLoads += 1;
      break;
    case "db-error":
      favouriteVideosCacheMetrics.dbErrors += 1;
      break;
    case "force-refresh":
      favouriteVideosCacheMetrics.forceRefreshes += 1;
      break;
  }

  if (favouriteVideosCacheMetrics.lookups === 0) {
    return;
  }

  const now = Date.now();
  const shouldLogByInterval =
    now - favouriteVideosCacheMetrics.lastLoggedAt >= FAVOURITE_VIDEOS_METRICS_LOG_INTERVAL_MS;
  const shouldLogByCount =
    favouriteVideosCacheMetrics.lookups % FAVOURITE_VIDEOS_METRICS_LOG_EVERY_LOOKUPS === 0;
  if (!shouldLogByInterval && !shouldLogByCount) {
    return;
  }

  favouriteVideosCacheMetrics.lastLoggedAt = now;
  const { lookups, hits, misses, inFlightReuses, dbLoads, dbErrors, forceRefreshes } =
    favouriteVideosCacheMetrics;
  const avoidedDbReads = hits + inFlightReuses;
  const hitRatePercent = lookups > 0 ? Number(((hits / lookups) * 100).toFixed(1)) : 0;
  const avoidedDbPercent = lookups > 0 ? Number(((avoidedDbReads / lookups) * 100).toFixed(1)) : 0;

  console.info("[favourite-videos-cache]", {
    lookups,
    hits,
    misses,
    inFlightReuses,
    dbLoads,
    dbErrors,
    forceRefreshes,
    hitRatePercent,
    avoidedDbPercent,
  });
}

// ── DB load ───────────────────────────────────────────────────────────────────

async function loadFavouriteVideosForUser(userId: number): Promise<VideoRecord[]> {
  markFavouriteVideosCacheMetric("db-load");

  const favourites = await prisma.favourite.findMany({
    where: { userid: userId },
    select: { videoId: true },
    take: 50,
  });

  const youtubeIds = favourites
    .map((f) => f.videoId)
    .filter((id): id is string => Boolean(id));

  if (youtubeIds.length === 0) {
    favouriteVideosCache.set(userId, []);
    return [];
  }

  const placeholders = youtubeIds.map(() => "?").join(", ");
  const videos = await prisma.$queryRawUnsafe<
    Array<{
      videoId: string;
      title: string;
      favourited: number | null;
      description: string | null;
    }>
  >(
    `
      SELECT v.videoId, v.title, v.favourited, v.description
      FROM videos v
      WHERE v.videoId IN (${placeholders})
        AND COALESCE(v.approved, 0) = 1
    `,
    ...youtubeIds,
  );

  const firstVideoById = new Map<string, (typeof videos)[number]>();

  for (const video of videos) {
    if (!firstVideoById.has(video.videoId)) {
      firstVideoById.set(video.videoId, video);
    }
  }

  const orderedVideos = youtubeIds
    .map((id) => firstVideoById.get(id))
    .filter((video): video is (typeof videos)[number] => Boolean(video));

  const mapped = orderedVideos.map((video) =>
    mapVideo({
      ...video,
      channelTitle: null,
    }),
  );

  favouriteVideosCache.set(userId, mapped);
  return mapped;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getFavouriteVideosInternal(
  userId?: number,
  options?: { forceRefresh?: boolean },
): Promise<VideoRecord[]> {
  if (!userId || !hasDatabaseUrl()) {
    return [];
  }

  const forceRefresh = Boolean(options?.forceRefresh);
  if (forceRefresh) {
    markFavouriteVideosCacheMetric("force-refresh");
  }

  if (!forceRefresh) {
    const cached = favouriteVideosCache.get(userId);
    if (cached) {
      markFavouriteVideosCacheMetric("hit");
      return cached;
    }

    markFavouriteVideosCacheMetric("miss");

    const inFlight = favouriteVideosInFlight.get(userId);
    if (inFlight) {
      markFavouriteVideosCacheMetric("inflight-reuse");
      return inFlight.then((videos) => videos.map((video) => ({ ...video })));
    }
  }

  const pending = loadFavouriteVideosForUser(userId);
  favouriteVideosInFlight.set(userId, pending);

  try {
    return (await pending).map((video) => ({ ...video }));
  } catch {
    markFavouriteVideosCacheMetric("db-error");
    return [];
  } finally {
    if (favouriteVideosInFlight.get(userId) === pending) {
      favouriteVideosInFlight.delete(userId);
    }
  }
}

export async function getFavouriteVideos(userId?: number): Promise<VideoRecord[]> {
  return getFavouriteVideosInternal(userId);
}

export async function fetchFavouriteVideoIds(userId: number, limit = 1000): Promise<Set<string>> {
  try {
    const rows = await prisma.favourite.findMany({
      where: { userid: userId },
      select: { videoId: true },
      take: limit,
    });

    return new Set(
      rows.map((row) => row.videoId).filter((id): id is string => Boolean(id)),
    );
  } catch {
    return new Set<string>();
  }
}

export function clearFavouritesCacheForUser(userId: number) {
  favouriteVideosCache.delete(userId);
  favouriteVideosInFlight.delete(userId);
}

export function clearFavouritesCaches() {
  favouriteVideosCache.clear();
  favouriteVideosInFlight.clear();
}
