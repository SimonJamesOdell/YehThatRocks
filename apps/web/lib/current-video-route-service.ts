import {
  getCurrentVideo,
  getFavouriteVideos,
  getHiddenVideoIdsForUser,
  getNewestVideos,
  getRelatedVideos,
  getSeenVideoIdsForUser,
  getTopVideos,
  getUnseenCatalogVideos,
  getVideoPlaybackDecision,
  pruneVideoAndAssociationsByVideoId,
} from "@/lib/catalog-data";
import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
import type { VideoRecord } from "@/lib/catalog";
import { prisma } from "@/lib/db";
import {
  DEFAULT_AUTOPLAY_MIX,
  doesVideoMatchAutoplayGenres,
  normalizeAutoplayGenreFilters,
  normalizeAutoplayMix,
  type AutoplayMixSettings,
} from "@/lib/player-preferences-shared";
import {
  blendRelatedWithFavourites,
  createSeededRandom,
  injectSparseFavourites,
  interleaveVideoBuckets,
  limitFavouritesInHead,
  pickBatchSourceVideos,
  shuffleVideos,
  shuffleWithRandom,
  uniqueVideosById,
} from "@/lib/current-video-route-utils";

const WATCH_NEXT_BATCH_BUILD_LIMIT = 200;

// Algorithm constants for resolveCurrentVideoPayload — kept here to avoid
// coupling the service to the route's constant declarations.
const RESOLVE_RELATED_POOL_QUERY_EXPANSION_CAP = 60_000;
const RESOLVE_WATCH_NEXT_FAVOURITE_INSERT_INTERVAL = 14;
const RESOLVE_WATCH_NEXT_HEAD_MIX_WINDOW = 30;
const RESOLVE_WATCH_NEXT_HEAD_MIX_MAX_FAVOURITES = 3;
const RESOLVE_CURRENT_VIDEO_TARGET_RELATED_COUNT = 8;

export type WatchNextVideo = Awaited<ReturnType<typeof getRelatedVideos>>[number];

export type ResolvedCurrentVideoPayload = {
  currentVideo: Awaited<ReturnType<typeof getCurrentVideo>>;
  relatedVideos: WatchNextVideo[];
  hasMore?: boolean;
};

export type CurrentVideoResolveResult =
  | ResolvedCurrentVideoPayload
  | { pending: true; denied?: { videoId: string; reason: string; message: string } };

export type WatchNextStreamCacheEntry = {
  expiresAt: number;
  videos: WatchNextVideo[];
  hasMore: boolean;
};

export async function fetchRandomCatalogVideosForCurrentVideo(params: {
  currentVideoId: string;
  count: number;
  getRandomVideoIdPool: () => Promise<readonly string[]>;
  genericArtistLabels: Set<string>;
}): Promise<WatchNextVideo[]> {
  const requested = Math.max(1, Math.min(2_000, Math.floor(params.count)));

  const pool = await params.getRandomVideoIdPool();
  const eligible = pool.filter((id) => id !== params.currentVideoId);
  if (eligible.length === 0) {
    return [];
  }

  // Pick a random window from the pre-shuffled pool rather than running a DB
  // range scan from a random ID. This avoids the O(N) id-gap scan that caused
  // Hotspot 2 (67M rows examined when the random start lands in a sparse area).
  const batchSize = Math.min(eligible.length, Math.max(80, requested * 2));
  const maxStart = Math.max(0, eligible.length - batchSize);
  const startIdx = Math.floor(Math.random() * (maxStart + 1));
  const selectedIds = eligible.slice(startIdx, startIdx + batchSize);

  const placeholders = selectedIds.map(() => "?").join(", ");
  const fetchSql = `
    SELECT
      v.id AS dbId,
      v.videoId AS id,
      v.title AS title,
      COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), ''), NULL) AS channelTitle,
      COALESCE(v.favourited, 0) AS favourited,
      v.description AS description
    FROM videos v
    WHERE v.videoId IN (${placeholders})
  `;

  const fetched = await prisma.$queryRawUnsafe<Array<{
    dbId: number;
    id: string;
    title: string;
    channelTitle: string | null;
    favourited: number | null;
    description: string | null;
  }>>(fetchSql, ...selectedIds);

  const rows = uniqueVideosById(fetched).slice(0, requested);

  const repairedArtists = rows
    .map((row) => {
      const normalizedCurrentArtist = (row.channelTitle ?? "").trim().toLowerCase();
      const hasMeaningfulArtist = Boolean(normalizedCurrentArtist) && !params.genericArtistLabels.has(normalizedCurrentArtist);
      if (hasMeaningfulArtist) {
        return null;
      }

      const inferredArtist = inferArtistFromTitle(row.title)?.trim();
      if (!inferredArtist) {
        return null;
      }

      return { dbId: row.dbId, inferredArtist };
    })
    .filter((entry): entry is { dbId: number; inferredArtist: string } => Boolean(entry));

  if (repairedArtists.length > 0) {
    // Best-effort data repair: fill parsedArtist when we can infer a reliable artist from title.
    void Promise.all(repairedArtists.map(({ dbId, inferredArtist }) => prisma.$executeRaw`
      UPDATE videos
      SET parsedArtist = ${inferredArtist}
      WHERE id = ${dbId}
        AND (parsedArtist IS NULL OR TRIM(parsedArtist) = '')
    `));
  }

  return rows.map((row) => {
    const normalizedCurrentArtist = (row.channelTitle ?? "").trim().toLowerCase();
    const inferredArtist = inferArtistFromTitle(row.title)?.trim();
    const resolvedArtist = row.channelTitle?.trim() && !params.genericArtistLabels.has(normalizedCurrentArtist)
      ? row.channelTitle.trim()
      : inferredArtist || "Unknown Artist";

    return {
      id: row.id,
      title: row.title,
      channelTitle: resolvedArtist,
      genre: "",
      favourited: Number(row.favourited ?? 0),
      description: row.description ?? "",
    } satisfies VideoRecord;
  });
}

export async function buildWatchNextRelatedStream(params: {
  currentVideoId: string;
  userId?: number;
  offset: number;
  count: number;
  blockedIds: Set<string>;
  favouriteVideos: WatchNextVideo[];
  watchNextBatchSize: number;
  watchNextSourceSliceSize: number;
  watchNextTopPoolSize: number;
  watchNextNewestPoolSize: number;
  watchNextRandomPoolMin: number;
  watchNextMix: AutoplayMixSettings;
  autoplayGenreFilters: string[];
  getTopPool: (size: number) => Promise<WatchNextVideo[]>;
  getRandomPool: (currentVideoId: string, size: number) => Promise<WatchNextVideo[]>;
}): Promise<{ videos: WatchNextVideo[]; hasMore: boolean }> {
  const targetCount = Math.max(1, params.count);
  const targetTotal = params.offset + targetCount;
  const seedBase = `${params.currentVideoId}:u:${params.userId ?? 0}:o:${params.offset}:c:${params.count}`;

  const [topPoolRaw, newestPoolRaw, randomPoolRaw] = await Promise.all([
    params.getTopPool(params.watchNextTopPoolSize),
    getNewestVideos(params.watchNextNewestPoolSize, 0),
    params.getRandomPool(
      params.currentVideoId,
      Math.max(params.watchNextRandomPoolMin, targetTotal + params.watchNextBatchSize * 2),
    ),
  ]);

  const effectiveMix = normalizeAutoplayMix(params.watchNextMix);
  const effectiveGenreFilters = normalizeAutoplayGenreFilters(params.autoplayGenreFilters);

  const byGenre = (videos: WatchNextVideo[]) => {
    if (effectiveGenreFilters.length === 0) {
      return videos;
    }

    return videos.filter((video) => doesVideoMatchAutoplayGenres(video.genre, effectiveGenreFilters));
  };

  const sourceCountsForBatch = (() => {
    const total = params.watchNextBatchSize;
    const entries = [
      { key: "favourites" as const, raw: (effectiveMix.favourites / 100) * total },
      { key: "top" as const, raw: (effectiveMix.top100 / 100) * total },
      { key: "newest" as const, raw: (effectiveMix.newest / 100) * total },
      { key: "random" as const, raw: (effectiveMix.random / 100) * total },
    ].map((entry) => ({ ...entry, floor: Math.floor(entry.raw), frac: entry.raw - Math.floor(entry.raw) }));

    let remaining = total - entries.reduce((sum, entry) => sum + entry.floor, 0);
    const byFrac = [...entries].sort((a, b) => b.frac - a.frac);
    const extraByKey: Record<(typeof byFrac)[number]["key"], number> = {
      favourites: 0,
      top: 0,
      newest: 0,
      random: 0,
    };

    for (const entry of byFrac) {
      if (remaining <= 0) {
        break;
      }

      extraByKey[entry.key] += 1;
      remaining -= 1;
    }

    return {
      favourites: (entries.find((entry) => entry.key === "favourites")?.floor ?? 0) + extraByKey.favourites,
      top: (entries.find((entry) => entry.key === "top")?.floor ?? 0) + extraByKey.top,
      newest: (entries.find((entry) => entry.key === "newest")?.floor ?? 0) + extraByKey.newest,
      random: (entries.find((entry) => entry.key === "random")?.floor ?? 0) + extraByKey.random,
    };
  })();

  const removeBlocked = (videos: WatchNextVideo[]) => videos.filter((video) => !params.blockedIds.has(video.id));
  const topPool = byGenre(removeBlocked(topPoolRaw));
  const newestPool = byGenre(removeBlocked(newestPoolRaw));
  const randomPool = byGenre(removeBlocked(randomPoolRaw));
  const favouritePool = byGenre(removeBlocked(params.favouriteVideos));

  const globalUsedIds = new Set(params.blockedIds);
  const stream: WatchNextVideo[] = [];
  let batchNumber = 0;
  let canContinue = true;

  while (stream.length < targetTotal && canContinue && batchNumber < WATCH_NEXT_BATCH_BUILD_LIMIT) {
    const batchBlockedIds = new Set(globalUsedIds);
    const batchRandom = createSeededRandom(`${seedBase}:batch:${batchNumber}`);

    const favourites = pickBatchSourceVideos({
      source: favouritePool,
      count: sourceCountsForBatch.favourites,
      blockedIds: batchBlockedIds,
      random: batchRandom,
      labels: { isFavouriteSource: true },
    });
    const top = pickBatchSourceVideos({
      source: topPool,
      count: sourceCountsForBatch.top,
      blockedIds: batchBlockedIds,
      random: batchRandom,
      labels: { isTop100Source: true, sourceLabel: "Top100" },
    });
    const newest = pickBatchSourceVideos({
      source: newestPool,
      count: sourceCountsForBatch.newest,
      blockedIds: batchBlockedIds,
      random: batchRandom,
      labels: { isNewSource: true, sourceLabel: "New" },
    });
    const randoms = pickBatchSourceVideos({
      source: randomPool,
      count: sourceCountsForBatch.random,
      blockedIds: batchBlockedIds,
      random: batchRandom,
    });

    let batch = [...favourites, ...top, ...newest, ...randoms];

    if (batch.length < params.watchNextBatchSize) {
      const topOff = pickBatchSourceVideos({
        source: interleaveVideoBuckets([randomPool, newestPool, topPool]),
        count: params.watchNextBatchSize - batch.length,
        blockedIds: batchBlockedIds,
        random: batchRandom,
      });
      batch = [...batch, ...topOff];
    }

    if (batch.length === 0) {
      canContinue = false;
      break;
    }

    const shuffledBatch = shuffleWithRandom(batch, createSeededRandom(`${seedBase}:shuffle:${batchNumber}`));
    for (const video of shuffledBatch) {
      globalUsedIds.add(video.id);
      stream.push(video);
    }

    batchNumber += 1;
  }

  const sliceStart = Math.min(params.offset, stream.length);
  const sliceEnd = Math.min(stream.length, sliceStart + targetCount);
  const videos = stream.slice(sliceStart, sliceEnd);
  const hasMore = sliceEnd < stream.length || canContinue;

  return { videos, hasMore };
}

export async function resolveWatchNextStreamSlice(params: {
  currentVideoId: string;
  userId?: number;
  offset: number;
  count: number;
  requiredSize: number;
  cacheKey: string;
  watchNextBatchSize: number;
  watchNextStreamCacheTtlMs: number;
  watchNextStreamCache: Map<string, WatchNextStreamCacheEntry>;
  watchNextStreamInflight: Map<string, Promise<WatchNextStreamCacheEntry>>;
  pruneCaches: () => void;
  buildStream: (targetCount: number) => Promise<{ videos: WatchNextVideo[]; hasMore: boolean }>;
}): Promise<{ videos: WatchNextVideo[]; hasMore: boolean }> {
  params.pruneCaches();

  const now = Date.now();
  const cached = params.watchNextStreamCache.get(params.cacheKey);

  if (cached && cached.expiresAt > now) {
    const hasRequiredRows = cached.videos.length >= params.requiredSize;
    const canServeFromTail = !cached.hasMore && cached.videos.length >= (params.offset + params.count);

    if (hasRequiredRows || canServeFromTail) {
      const start = Math.min(params.offset, cached.videos.length);
      const end = Math.min(cached.videos.length, start + params.count);
      return {
        videos: cached.videos.slice(start, end),
        hasMore: end < cached.videos.length || cached.hasMore,
      };
    }
  }

  const inFlight = params.watchNextStreamInflight.get(params.cacheKey);
  if (inFlight) {
    const inflightEntry = await inFlight;
    const start = Math.min(params.offset, inflightEntry.videos.length);
    const end = Math.min(inflightEntry.videos.length, start + params.count);
    return {
      videos: inflightEntry.videos.slice(start, end),
      hasMore: end < inflightEntry.videos.length || inflightEntry.hasMore,
    };
  }

  const targetCount = Math.max(
    params.requiredSize,
    (cached?.videos.length ?? 0) + params.watchNextBatchSize,
  );

  const pending = (async () => {
    const stream = await params.buildStream(targetCount);

    const entry: WatchNextStreamCacheEntry = {
      expiresAt: Date.now() + params.watchNextStreamCacheTtlMs,
      videos: stream.videos,
      hasMore: stream.hasMore,
    };
    params.watchNextStreamCache.set(params.cacheKey, entry);
    return entry;
  })();

  params.watchNextStreamInflight.set(params.cacheKey, pending);

  try {
    const entry = await pending;
    const start = Math.min(params.offset, entry.videos.length);
    const end = Math.min(entry.videos.length, start + params.count);
    return {
      videos: entry.videos.slice(start, end),
      hasMore: end < entry.videos.length || entry.hasMore,
    };
  } finally {
    if (params.watchNextStreamInflight.get(params.cacheKey) === pending) {
      params.watchNextStreamInflight.delete(params.cacheKey);
    }
  }
}

export async function resolveCurrentVideoPayload(params: {
  requestedVideoId: string | undefined;
  requestMode: string;
  requestedRelatedCount: number;
  requestedRelatedOffset: number;
  excludedRelatedIds: string[];
  isCustomRelatedRequest: boolean;
  usePagedRelatedPool: boolean;
  useUnifiedWatchNextPool: boolean;
  shouldFilterSeen: boolean;
  preferUnseenForEndedChoice: boolean;
  favouriteBlendRatio: number;
  userId: number | undefined;
  watchNextStreamSettings?: {
    autoplayMix: AutoplayMixSettings;
    autoplayGenreFilters: string[];
  };
  relatedPoolSize: number;
  favouriteVideosPromise: Promise<WatchNextVideo[]>;
  getWatchNextStreamSlice: (p: {
    currentVideoId: string;
    userId?: number;
    offset: number;
    count: number;
    blockedIds: Set<string>;
    favouriteVideos: WatchNextVideo[];
    autoplayMix: AutoplayMixSettings;
    autoplayGenreFilters: string[];
  }) => Promise<{ videos: WatchNextVideo[]; hasMore: boolean }>;
  getRelatedPoolForCurrentVideo: (
    currentVideoId: string,
    userId: number | undefined,
    minimumSize: number,
    favouriteVideos?: WatchNextVideo[],
    hiddenVideoIds?: Set<string> | null,
  ) => Promise<WatchNextVideo[]>;
  getCachedTopVideosForCurrentVideo: (count: number) => Promise<WatchNextVideo[]>;
  logEvent: (event: string, detail?: Record<string, unknown>) => void;
  onPayloadResolved: (payload: ResolvedCurrentVideoPayload, resolvedVideoId: string) => void;
}): Promise<CurrentVideoResolveResult> {
  const v = params.requestedVideoId;
  let seenVideoIdsForRequest: Set<string> | null = null;
  let hiddenVideoIdsForRequest: Set<string> | null = null;

  const getSeenVideoIdsForRequest = async () => {
    if (!params.shouldFilterSeen || !params.userId) {
      return null;
    }

    if (!seenVideoIdsForRequest) {
      seenVideoIdsForRequest = await getSeenVideoIdsForUser(params.userId);
    }

    return seenVideoIdsForRequest;
  };

  const getHiddenVideoIdsForRequest = async () => {
    if (!params.userId) {
      return null;
    }

    if (!hiddenVideoIdsForRequest) {
      hiddenVideoIdsForRequest = await getHiddenVideoIdsForUser(params.userId);
    }

    return hiddenVideoIdsForRequest;
  };

  if (v) {
    const decision = await getVideoPlaybackDecision(v);
    params.logEvent("request:decision", {
      requestedVideoId: v,
      allowed: decision.allowed,
      reason: decision.reason,
    });

    if (!decision.allowed) {
      if (decision.reason === "unavailable") {
        await pruneVideoAndAssociationsByVideoId(v, "api-current-video-denied-unavailable").catch(() => undefined);
      }

      params.logEvent("request:denied", {
        requestedVideoId: v,
        reason: decision.reason,
      });

      return {
        pending: true as const,
        denied: {
          videoId: v,
          reason: decision.reason,
          message: decision.message ?? "Sorry, that video cannot be played on YehThatRocks.",
        },
      };
    }
  }

  const currentVideo = await getCurrentVideo(v, { skipPlaybackDecision: Boolean(v) });
  if (!currentVideo?.id) {
    params.logEvent("request:pending", { requestedVideoId: v });

    return { pending: true as const };
  }

  let relatedVideos: WatchNextVideo[] = [];
  let hasMoreForCustomRequest: boolean | undefined;
  let earlyTopVideosForPadding: WatchNextVideo[] | undefined;
  const favouriteVideos = await params.favouriteVideosPromise;
  const favouriteVideoIdSet = new Set(favouriteVideos.map((video) => video.id));
  const allowFavouriteSeenBypass = params.requestMode !== "ended-choice";

  if (params.useUnifiedWatchNextPool) {
    const hiddenVideoIds = await getHiddenVideoIdsForRequest();
    const blockedIds = new Set<string>([currentVideo.id, ...params.excludedRelatedIds]);

    if (hiddenVideoIds && hiddenVideoIds.size > 0) {
      for (const videoId of hiddenVideoIds) {
        blockedIds.add(videoId);
      }
    }

    const { videos, hasMore } = await params.getWatchNextStreamSlice({
      currentVideoId: currentVideo.id,
      userId: params.userId,
      offset: params.requestedRelatedOffset,
      count: params.requestedRelatedCount,
      blockedIds,
      favouriteVideos,
          autoplayMix: params.watchNextStreamSettings?.autoplayMix ?? DEFAULT_AUTOPLAY_MIX,
          autoplayGenreFilters: params.watchNextStreamSettings?.autoplayGenreFilters ?? [],
    });

    relatedVideos = videos;
    hasMoreForCustomRequest = hasMore;
  } else if (params.usePagedRelatedPool) {
    const poolSizeTarget = Math.max(48, params.requestedRelatedOffset + params.requestedRelatedCount + 24);
    const relatedPool = await params.getRelatedPoolForCurrentVideo(
      currentVideo.id,
      params.userId,
      poolSizeTarget,
      favouriteVideos,
      await getHiddenVideoIdsForRequest(),
    );
    let filteredPool = params.excludedRelatedIds.length > 0
      ? relatedPool.filter((video) => !params.excludedRelatedIds.includes(video.id))
      : relatedPool;

    if (params.preferUnseenForEndedChoice && params.userId) {
      const seenVideoIds = await getSeenVideoIdsForUser(params.userId);
      seenVideoIdsForRequest = seenVideoIds;
      const unseenBoost = await getUnseenCatalogVideos({
        userId: params.userId,
        count: Math.max(300, Math.min(RESOLVE_RELATED_POOL_QUERY_EXPANSION_CAP, poolSizeTarget)),
        excludeVideoIds: [currentVideo.id, ...params.excludedRelatedIds],
      });

      filteredPool = uniqueVideosById([
        ...unseenBoost,
        ...filteredPool,
      ]);
    }

    filteredPool = blendRelatedWithFavourites(
      filteredPool,
      favouriteVideos,
      currentVideo.id,
      params.favouriteBlendRatio,
    );

    if (params.shouldFilterSeen) {
      const seenVideoIds = await getSeenVideoIdsForRequest();
      if (seenVideoIds) {
        filteredPool = filteredPool.filter((video) => !seenVideoIds.has(video.id));
      }
    }

    const start = Math.min(params.requestedRelatedOffset, filteredPool.length);
    const end = Math.min(filteredPool.length, start + params.requestedRelatedCount);
    relatedVideos = filteredPool.slice(start, end);
    hasMoreForCustomRequest = end < filteredPool.length;
  } else {
    const requestedWithProbe = Math.min(30, params.requestedRelatedCount + 1);
    // Start top-video prefetch in parallel so padding is zero-cost if the
    // related set comes back smaller than the target batch size.
    const paddingTopVideosPromise = params.getCachedTopVideosForCurrentVideo(30);
    const fetchedRelatedVideos = await getRelatedVideos(currentVideo.id, {
      userId: params.userId,
      count: requestedWithProbe,
      excludeVideoIds: params.excludedRelatedIds,
    });
    earlyTopVideosForPadding = await paddingTopVideosPromise;
    const blendedRelatedVideos = blendRelatedWithFavourites(
      fetchedRelatedVideos,
      favouriteVideos,
      currentVideo.id,
      params.favouriteBlendRatio,
    );
    const hiddenVideoIds = await getHiddenVideoIdsForRequest();
    const visibleNonHiddenVideos = hiddenVideoIds && hiddenVideoIds.size > 0
      ? blendedRelatedVideos.filter((video) => !hiddenVideoIds.has(video.id))
      : blendedRelatedVideos;
    const seenVideoIds = await getSeenVideoIdsForRequest();
    const visibleRelatedVideos = seenVideoIds
      ? visibleNonHiddenVideos.filter((video) => {
        if (!seenVideoIds.has(video.id)) {
          return true;
        }

        return allowFavouriteSeenBypass && favouriteVideoIdSet.has(video.id);
      })
      : visibleNonHiddenVideos;
    hasMoreForCustomRequest = visibleRelatedVideos.length > params.requestedRelatedCount;
    relatedVideos = visibleRelatedVideos.slice(0, params.requestedRelatedCount);
  }

  let paddedRelatedVideos = relatedVideos;

  if (!params.isCustomRelatedRequest && relatedVideos.length < RESOLVE_CURRENT_VIDEO_TARGET_RELATED_COUNT) {
    const topVideos = earlyTopVideosForPadding ?? await params.getCachedTopVideosForCurrentVideo(30);
    const seenVideoIds = await getSeenVideoIdsForRequest();
    const hiddenVideoIds = await getHiddenVideoIdsForRequest();
    const blockedIds = new Set([currentVideo.id, ...relatedVideos.map((video) => video.id)]);
    const fillerPool = uniqueVideosById(topVideos.filter((video) => {
      if (blockedIds.has(video.id)) {
        return false;
      }

      if (hiddenVideoIds?.has(video.id)) {
        return false;
      }

      if (seenVideoIds?.has(video.id)) {
        if (!allowFavouriteSeenBypass || !favouriteVideoIdSet.has(video.id)) {
          return false;
        }
      }

      return true;
    }));
    const filler = shuffleVideos(fillerPool).slice(0, RESOLVE_CURRENT_VIDEO_TARGET_RELATED_COUNT - relatedVideos.length);
    paddedRelatedVideos = [...relatedVideos, ...filler];
  }

  // Final hidden-video filtering should reuse the request-scoped hidden id set.
  if (params.userId) {
    const hiddenVideoIds = await getHiddenVideoIdsForRequest();
    if (hiddenVideoIds && hiddenVideoIds.size > 0) {
      paddedRelatedVideos = paddedRelatedVideos.filter((video) => !hiddenVideoIds.has(video.id));
    }
  }

  const normalizedPayload: ResolvedCurrentVideoPayload = {
    currentVideo,
    relatedVideos: paddedRelatedVideos,
    hasMore: params.isCustomRelatedRequest ? hasMoreForCustomRequest : undefined,
  };

  params.onPayloadResolved(normalizedPayload, currentVideo.id);

  params.logEvent("request:success", {
    requestedVideoId: v,
    resolvedVideoId: currentVideo.id,
    relatedCount: paddedRelatedVideos.length,
  });

  return normalizedPayload;
}
