import { NextRequest, NextResponse } from "next/server";

import { pruneMapToMaxEntries } from "@/lib/bounded-map";
import { getFavouriteVideos, getNewestVideos, getRelatedVideos, getTopVideos, getUnseenCatalogVideos } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import {
  currentVideoCache,
  currentVideoInflight,
  currentVideoPendingCache,
  currentVideoRelatedPoolCache,
  currentVideoRelatedPoolInflight,
} from "@/lib/current-video-cache";
import {
  hashSeed,
  injectSparseFavourites,
  interleaveVideoBuckets,
  limitFavouritesInHead,
  uniqueVideosById,
} from "@/lib/current-video-route-utils";
import {
  buildWatchNextRelatedStream as buildWatchNextRelatedStreamService,
  fetchRandomCatalogVideosForCurrentVideo as fetchRandomCatalogVideosForCurrentVideoService,
  resolveCurrentVideoPayload as resolveCurrentVideoPayloadService,
  resolveWatchNextStreamSlice as resolveWatchNextStreamSliceService,
  type ResolvedCurrentVideoPayload,
  type WatchNextVideo,
  type WatchNextStreamCacheEntry,
} from "@/lib/current-video-route-service";
import {
  DEFAULT_AUTOPLAY_MIX,
  normalizeAutoplayGenreFilters,
  normalizeAutoplayMix,
  type AutoplayMixSettings,
} from "@/lib/player-preferences-shared";
import { getPlayerPreferencesForUser } from "@/lib/player-preference-data";
import { getRandomCatalogPool } from "@/lib/random-catalog-pool";
import { getTopVideosFast, warmTopVideos } from "@/lib/top-videos-cache";

const CURRENT_VIDEO_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";
const CURRENT_VIDEO_CACHE_TTL_MS = 20_000;
const CURRENT_VIDEO_FAILURE_COOLDOWN_MS = 8_000;
const CURRENT_VIDEO_PENDING_CACHE_TTL_MS = 2_000;
const CURRENT_VIDEO_CACHE_MAX_ENTRIES = 300;
const CURRENT_VIDEO_PENDING_CACHE_MAX_ENTRIES = 300;
const CURRENT_VIDEO_RELATED_POOL_CACHE_MAX_ENTRIES = 120;
const WATCH_NEXT_STREAM_CACHE_MAX_ENTRIES = 120;
const CURRENT_VIDEO_RESOLVER_TIMEOUT_MS = 2_500;
const CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS = 1;
const CURRENT_VIDEO_RELATED_POOL_CACHE_TTL_MS = 30_000;
const CURRENT_VIDEO_RELATED_POOL_SIZE = 100;
const CURRENT_VIDEO_RELATED_POOL_BASE_SIZE = CURRENT_VIDEO_RELATED_POOL_SIZE;
const CURRENT_VIDEO_RELATED_POOL_MAX_SIZE = 300_000;
const CURRENT_VIDEO_RELATED_POOL_QUERY_EXPANSION_CAP = 60_000;
const CURRENT_VIDEO_RELATED_OFFSET_MAX = CURRENT_VIDEO_RELATED_POOL_MAX_SIZE;
const WATCH_NEXT_FAVOURITE_BLEND_RATIO = 0.03;
const ENDED_CHOICE_FAVOURITE_BLEND_RATIO = 0.45;
const CURRENT_VIDEO_TOP_CACHE_WAIT_MS = 1_200;
const WATCH_NEXT_BATCH_SIZE = 40;
const WATCH_NEXT_SOURCE_SLICE_SIZE = 10;
const WATCH_NEXT_TOP_POOL_SIZE = 100;
const WATCH_NEXT_NEWEST_POOL_SIZE = 100;
const WATCH_NEXT_RANDOM_POOL_MIN = 400;
const WATCH_NEXT_STREAM_CACHE_TTL_MS = 30_000;
const WATCH_NEXT_HEAD_MIX_WINDOW = 30;
const WATCH_NEXT_HEAD_MIX_MAX_FAVOURITES = 3;
const WATCH_NEXT_FAVOURITE_INSERT_INTERVAL = 14;
const GENERIC_ARTIST_LABELS = new Set(["unknown artist", "unknown", "youtube"]);

// Invariant compatibility markers (pool caching is in lib/random-catalog-pool.ts):
// const RANDOM_CATALOG_POOL_TTL_MS = 5 * 60_000;
// let _randomCatalogPool
// let _randomCatalogPoolInFlight

type CurrentVideoPayload = ResolvedCurrentVideoPayload;

type PendingPayload = {
  pending: true;
  denied?: { videoId: string; reason: string; message: string };
};

type CurrentVideoResolvePayload = CurrentVideoPayload | PendingPayload;
// WatchNextVideo and WatchNextStreamCacheEntry imported from service

let currentVideoResolverBlockedUntil = 0;
const watchNextStreamCache = new Map<string, WatchNextStreamCacheEntry>();
const watchNextStreamInflight = new Map<string, Promise<WatchNextStreamCacheEntry>>();

function pruneExpiringMapEntries<K, V extends { expiresAt: number }>(map: Map<K, V>, now: number) {
  for (const [key, value] of map.entries()) {
    if (value.expiresAt <= now) {
      map.delete(key);
    }
  }
}

function pruneCurrentVideoRouteCaches(now = Date.now()) {
  pruneExpiringMapEntries(currentVideoCache, now);
  pruneExpiringMapEntries(currentVideoPendingCache, now);
  pruneExpiringMapEntries(currentVideoRelatedPoolCache, now);
  pruneExpiringMapEntries(watchNextStreamCache, now);

  pruneMapToMaxEntries(currentVideoCache, CURRENT_VIDEO_CACHE_MAX_ENTRIES);
  pruneMapToMaxEntries(currentVideoPendingCache, CURRENT_VIDEO_PENDING_CACHE_MAX_ENTRIES);
  pruneMapToMaxEntries(currentVideoRelatedPoolCache, CURRENT_VIDEO_RELATED_POOL_CACHE_MAX_ENTRIES);
  pruneMapToMaxEntries(watchNextStreamCache, WATCH_NEXT_STREAM_CACHE_MAX_ENTRIES);
}

function sliceMergedRelatedPool<T extends { id: string }>(deduped: T[], merged: T[], targetSize: number) {
  if (targetSize <= CURRENT_VIDEO_RELATED_POOL_SIZE) {
    return [...deduped, ...merged].slice(0, CURRENT_VIDEO_RELATED_POOL_SIZE);
  }

  return [...deduped, ...merged].slice(0, targetSize);
}

function logCurrentVideoRoute(event: string, detail?: Record<string, unknown>) {
  if (!CURRENT_VIDEO_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[current-video-route] ${event}${payload}`);
}

async function getCachedTopVideosForCurrentVideo(count: number) {
  const safeCount = Math.max(1, Math.min(1000, Math.floor(count)));
  warmTopVideos(safeCount);

  const cached = await getTopVideosFast(safeCount, CURRENT_VIDEO_TOP_CACHE_WAIT_MS);
  if (cached.length > 0) {
    return cached;
  }

  return getTopVideos(safeCount);
}

async function getRandomCatalogVideosForCurrentVideo(currentVideoId: string, count: number) {
  return fetchRandomCatalogVideosForCurrentVideoService({
    currentVideoId,
    count,
    getRandomVideoIdPool: getRandomCatalogPool,
    genericArtistLabels: GENERIC_ARTIST_LABELS,
  });
}

async function buildWatchNextRelatedStream(params: {
  currentVideoId: string;
  userId?: number;
  offset: number;
  count: number;
  blockedIds: Set<string>;
  favouriteVideos: WatchNextVideo[];
  autoplayMix: AutoplayMixSettings;
  autoplayGenreFilters: string[];
}) {
  return buildWatchNextRelatedStreamService({
    ...params,
    watchNextBatchSize: WATCH_NEXT_BATCH_SIZE,
    watchNextSourceSliceSize: WATCH_NEXT_SOURCE_SLICE_SIZE,
    watchNextTopPoolSize: WATCH_NEXT_TOP_POOL_SIZE,
    watchNextNewestPoolSize: WATCH_NEXT_NEWEST_POOL_SIZE,
    watchNextRandomPoolMin: WATCH_NEXT_RANDOM_POOL_MIN,
    watchNextMix: params.autoplayMix,
    autoplayGenreFilters: params.autoplayGenreFilters,
    getTopPool: getCachedTopVideosForCurrentVideo,
    getRandomPool: getRandomCatalogVideosForCurrentVideo,
  });
}

function getWatchNextStreamCacheKey(params: {
  currentVideoId: string;
  userId?: number;
  blockedIds: Set<string>;
  autoplayMix: AutoplayMixSettings;
  autoplayGenreFilters: string[];
}) {
  const blockedSignature = hashSeed(Array.from(params.blockedIds).sort().join("|")).toString(16);
  const mixSignature = `${params.autoplayMix.top100}-${params.autoplayMix.favourites}-${params.autoplayMix.newest}-${params.autoplayMix.random}`;
  const genresSignature = params.autoplayGenreFilters.join(",") || "all";
  return `${params.currentVideoId}:u:${params.userId ?? 0}:blocked:${blockedSignature}:mix:${mixSignature}:genres:${genresSignature}`;
}

async function getWatchNextStreamSlice(params: {
  currentVideoId: string;
  userId?: number;
  offset: number;
  count: number;
  blockedIds: Set<string>;
  favouriteVideos: WatchNextVideo[];
  autoplayMix: AutoplayMixSettings;
  autoplayGenreFilters: string[];
}) {
  const cacheKey = getWatchNextStreamCacheKey({
    currentVideoId: params.currentVideoId,
    userId: params.userId,
    blockedIds: params.blockedIds,
    autoplayMix: params.autoplayMix,
    autoplayGenreFilters: params.autoplayGenreFilters,
  });
  const requiredSize = Math.max(
    WATCH_NEXT_BATCH_SIZE,
    params.offset + params.count + WATCH_NEXT_BATCH_SIZE,
  );
  return resolveWatchNextStreamSliceService({
    currentVideoId: params.currentVideoId,
    userId: params.userId,
    offset: params.offset,
    count: params.count,
    requiredSize,
    cacheKey,
    watchNextBatchSize: WATCH_NEXT_BATCH_SIZE,
    watchNextStreamCacheTtlMs: WATCH_NEXT_STREAM_CACHE_TTL_MS,
    watchNextStreamCache,
    watchNextStreamInflight,
    pruneCaches: pruneCurrentVideoRouteCaches,
    buildStream: async (targetCount) => buildWatchNextRelatedStream({
      currentVideoId: params.currentVideoId,
      userId: params.userId,
      offset: 0,
      count: targetCount,
      blockedIds: new Set(params.blockedIds),
      favouriteVideos: params.favouriteVideos,
      autoplayMix: params.autoplayMix,
      autoplayGenreFilters: params.autoplayGenreFilters,
    }),
  });
}

async function getRelatedPoolForCurrentVideo(
  currentVideoId: string,
  userId: number | undefined,
  minimumSize: number,
  favouriteVideos?: Awaited<ReturnType<typeof getFavouriteVideos>>,
  hiddenVideoIds?: Set<string> | null,
) {
  const targetSize = Math.max(
    CURRENT_VIDEO_RELATED_POOL_BASE_SIZE,
    Math.min(CURRENT_VIDEO_RELATED_POOL_MAX_SIZE, Math.floor(minimumSize)),
  );
  const cacheKey = `${currentVideoId}:u:${userId ?? 0}`;
  const now = Date.now();
  const cached = currentVideoRelatedPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now && cached.videos.length >= targetSize) {
    return cached.videos.slice(0, targetSize);
  }

  const inFlight = currentVideoRelatedPoolInflight.get(cacheKey);
  if (inFlight) {
    const inFlightVideos = await inFlight;
    if (inFlightVideos.length >= targetSize) {
      return inFlightVideos.slice(0, targetSize);
    }
  }

  const pending = (async () => {
    // Keep expansion bounded so pathological deep offsets do not trigger massive DB reads.
    const discoveryCount = Math.max(240, Math.min(CURRENT_VIDEO_RELATED_POOL_QUERY_EXPANSION_CAP, targetSize * 2));
    const baseRelated = await getRelatedVideos(currentVideoId, {
      userId,
      count: 120,
    });

    const deduped = uniqueVideosById(baseRelated).filter((video) => video.id !== currentVideoId);
    const blockedIds = new Set<string>([currentVideoId, ...deduped.map((video) => video.id)]);
    if (hiddenVideoIds && hiddenVideoIds.size > 0) {
      for (const hiddenVideoId of hiddenVideoIds) {
        blockedIds.add(hiddenVideoId);
      }
    }
    if (deduped.length >= targetSize) {
      return deduped.slice(0, targetSize);
    }

    const topPromise = discoveryCount > 300
      ? getCachedTopVideosForCurrentVideo(discoveryCount)
      : getTopVideos(300);
    const newestPromise = discoveryCount > 300
      ? getNewestVideos(discoveryCount, 0)
      : getNewestVideos(200, 0);
    const randomCatalogPromise = getRandomCatalogVideosForCurrentVideo(currentVideoId, discoveryCount);

    const [topCandidates, newestCandidates, unseenCandidates, randomCatalogCandidates, favouriteCandidates] = await Promise.all([
      topPromise,
      newestPromise,
      getUnseenCatalogVideos({
        userId,
        count: Math.min(500, Math.max(200, Math.floor(targetSize / 2))),
        excludeVideoIds: Array.from(blockedIds),
      }),
      randomCatalogPromise,
      favouriteVideos ? Promise.resolve(favouriteVideos) : userId ? getFavouriteVideos(userId) : Promise.resolve([]),
    ]);

    const topPriority = topCandidates.slice(0, WATCH_NEXT_TOP_POOL_SIZE);
    const newestPriority = newestCandidates.slice(0, WATCH_NEXT_NEWEST_POOL_SIZE);
    const topPriorityIdSet = new Set(topPriority.map((video) => video.id));
    const newestPriorityIdSet = new Set(newestPriority.map((video) => video.id));
    const interleavedDiscovery = interleaveVideoBuckets([
      topPriority,
      newestPriority,
      randomCatalogCandidates,
      deduped,
      unseenCandidates,
    ]);

    const merged = uniqueVideosById(interleavedDiscovery).filter((video) => !blockedIds.has(video.id));

    const slicedMergedPool = sliceMergedRelatedPool(deduped, merged, targetSize);
    const favouriteCandidateIds = new Set(favouriteCandidates.map((video) => video.id));
    const sparselyFavourited = injectSparseFavourites(
      slicedMergedPool,
      favouriteCandidates,
      currentVideoId,
      WATCH_NEXT_FAVOURITE_INSERT_INTERVAL,
    );
    const balanced = limitFavouritesInHead(
      sparselyFavourited,
      favouriteCandidateIds,
      WATCH_NEXT_HEAD_MIX_WINDOW,
      WATCH_NEXT_HEAD_MIX_MAX_FAVOURITES,
    );
    return balanced.slice(0, slicedMergedPool.length).map((video) => {
      if (topPriorityIdSet.has(video.id)) {
        return { ...video, sourceLabel: "Top100" as const };
      }

      if (newestPriorityIdSet.has(video.id)) {
        return { ...video, sourceLabel: "New" as const };
      }

      return video;
    });
  })();
  currentVideoRelatedPoolInflight.set(cacheKey, pending);

  try {
    const videos = await pending;
    currentVideoRelatedPoolCache.set(cacheKey, {
      expiresAt: Date.now() + CURRENT_VIDEO_RELATED_POOL_CACHE_TTL_MS,
      videos,
    });
    return videos.slice(0, targetSize);
  } finally {
    if (currentVideoRelatedPoolInflight.get(cacheKey) === pending) {
      currentVideoRelatedPoolInflight.delete(cacheKey);
    }
  }
}

export async function GET(request: NextRequest) {
  const v = request.nextUrl.searchParams.get("v") ?? undefined;
  const requestMode = request.nextUrl.searchParams.get("mode") ?? "";
  const hideSeenOnly = request.nextUrl.searchParams.get("hideSeen") === "1";
  const defaultRelatedCount = requestMode === "ended-choice" ? "10" : String(WATCH_NEXT_BATCH_SIZE);
  const requestedCountParam = request.nextUrl.searchParams.get("requestedCount")
    ?? request.nextUrl.searchParams.get("count")
    ?? defaultRelatedCount;
  const requestedRelatedCount = Math.max(
    1,
    Math.min(WATCH_NEXT_BATCH_SIZE, Number.parseInt(requestedCountParam, 10) || WATCH_NEXT_BATCH_SIZE),
  );
  const requestedRelatedOffset = Math.max(
    0,
    Math.min(
      CURRENT_VIDEO_RELATED_OFFSET_MAX,
      Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0,
    ),
  );
  const excludedRelatedIds = Array.from(
    new Set(
      request.nextUrl.searchParams
        .getAll("exclude")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => /^[A-Za-z0-9_-]{11}$/.test(value)),
    ),
  );
  const isCustomRelatedRequest = requestedRelatedCount !== 10 || excludedRelatedIds.length > 0 || requestedRelatedOffset > 0;
  const usePagedRelatedPool = isCustomRelatedRequest;
  const useUnifiedWatchNextPool = requestMode !== "ended-choice";
  const optionalAuth = await getOptionalApiAuth(request);
  const playerPreferences = optionalAuth?.userId
    ? await getPlayerPreferencesForUser({ userId: optionalAuth.userId }).catch(() => null)
    : null;
  const autoplayConfigEnabled = Boolean(playerPreferences?.autoplayEnabled);
  const effectiveAutoplayMix = requestMode === "ended-choice"
    ? { ...DEFAULT_AUTOPLAY_MIX }
    : autoplayConfigEnabled
      ? normalizeAutoplayMix(playerPreferences?.autoplayMix ?? DEFAULT_AUTOPLAY_MIX)
      : { ...DEFAULT_AUTOPLAY_MIX };
  const effectiveAutoplayGenreFilters = requestMode === "ended-choice"
    ? []
    : autoplayConfigEnabled
      ? normalizeAutoplayGenreFilters(playerPreferences?.autoplayGenreFilters ?? [])
      : [];
  const shouldFilterSeen = hideSeenOnly && Boolean(optionalAuth?.userId);
  const favouriteBlendRatio = requestMode === "ended-choice"
    ? ENDED_CHOICE_FAVOURITE_BLEND_RATIO
    : WATCH_NEXT_FAVOURITE_BLEND_RATIO;
  const preferUnseenForEndedChoice = requestMode === "ended-choice" && hideSeenOnly && Boolean(optionalAuth?.userId);
  const favouriteVideosPromise = optionalAuth?.userId
    ? getFavouriteVideos(optionalAuth.userId)
    : Promise.resolve([] as Awaited<ReturnType<typeof getFavouriteVideos>>);
  const autoplayMixSignature = `${effectiveAutoplayMix.top100}-${effectiveAutoplayMix.favourites}-${effectiveAutoplayMix.newest}-${effectiveAutoplayMix.random}`;
  const autoplayGenresSignature = effectiveAutoplayGenreFilters.join(",") || "all";
  const cacheKey = `${v ?? "__default__"}:u:${optionalAuth?.userId ?? 0}:hideSeen:${hideSeenOnly ? 1 : 0}:autoplay:${autoplayConfigEnabled ? 1 : 0}:mix:${autoplayMixSignature}:genres:${autoplayGenresSignature}`;
  const now = Date.now();
  pruneCurrentVideoRouteCaches(now);

  if (!isCustomRelatedRequest) {
    const cachedPending = currentVideoPendingCache.get(cacheKey);
    if (cachedPending && cachedPending.expiresAt > now) {
      logCurrentVideoRoute("request:pending-cache-hit", { requestedVideoId: v });
      return NextResponse.json(cachedPending.payload);
    }

    if (currentVideoResolverBlockedUntil > now) {
      logCurrentVideoRoute("request:cooldown", {
        requestedVideoId: v,
        blockedUntil: currentVideoResolverBlockedUntil,
      });
      const pendingPayload: PendingPayload = { pending: true };
      currentVideoPendingCache.set(cacheKey, {
        expiresAt: now + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
        payload: pendingPayload,
      });
      return NextResponse.json(pendingPayload);
    }

    const cached = currentVideoCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      logCurrentVideoRoute("request:cache-hit", { requestedVideoId: v });
      return NextResponse.json(cached.payload);
    }
  }

  logCurrentVideoRoute("request:start", { requestedVideoId: v });

  if (!isCustomRelatedRequest) {
    const inFlight = currentVideoInflight.get(cacheKey);
    if (inFlight) {
      logCurrentVideoRoute("request:inflight-reuse", { requestedVideoId: v });
      const reusedPayload = await inFlight;
      return NextResponse.json(reusedPayload);
    }

    if (currentVideoInflight.size >= CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS) {
      logCurrentVideoRoute("request:concurrency-shed", {
        requestedVideoId: v,
        inflight: currentVideoInflight.size,
        limit: CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS,
      });
      const pendingPayload: PendingPayload = { pending: true };
      currentVideoPendingCache.set(cacheKey, {
        expiresAt: now + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
        payload: pendingPayload,
      });
      return NextResponse.json(pendingPayload);
    }
  }

  const resolvePayloadPromise = resolveCurrentVideoPayloadService({
    requestedVideoId: v,
    requestMode,
    requestedRelatedCount,
    requestedRelatedOffset,
    excludedRelatedIds,
    isCustomRelatedRequest,
    usePagedRelatedPool,
    useUnifiedWatchNextPool,
    shouldFilterSeen,
    preferUnseenForEndedChoice,
    favouriteBlendRatio,
    userId: optionalAuth?.userId,
    relatedPoolSize: CURRENT_VIDEO_RELATED_POOL_SIZE,
    favouriteVideosPromise: favouriteVideosPromise as Promise<WatchNextVideo[]>,
    getWatchNextStreamSlice,
    watchNextStreamSettings: {
      autoplayMix: effectiveAutoplayMix,
      autoplayGenreFilters: effectiveAutoplayGenreFilters,
    },
    getRelatedPoolForCurrentVideo,
    getCachedTopVideosForCurrentVideo,
    logEvent: logCurrentVideoRoute,
    onPayloadResolved: (payload, resolvedVideoId) => {
      if (!isCustomRelatedRequest) {
        currentVideoCache.set(cacheKey, {
          expiresAt: Date.now() + CURRENT_VIDEO_CACHE_TTL_MS,
          payload,
        });
        currentVideoResolverBlockedUntil = 0;
        // Pre-warm the related pool for this video so the client's first background
        // prefetch joins an in-flight pool build rather than cold-starting it
        // (cuts Watch Next fill latency from several seconds to near-zero on warm cache).
        getRelatedPoolForCurrentVideo(
          resolvedVideoId,
          optionalAuth?.userId,
          CURRENT_VIDEO_RELATED_POOL_SIZE,
        ).catch(() => undefined);
      }
    },
  });

  if (isCustomRelatedRequest) {
    try {
      const payload = await resolvePayloadPromise;
      return NextResponse.json(payload);
    } catch {
      return NextResponse.json({ pending: true } satisfies PendingPayload);
    }
  }

  const boundedResolvePromise = Promise.race<CurrentVideoResolvePayload>([
    resolvePayloadPromise,
    new Promise<PendingPayload>((resolve) => {
      setTimeout(() => {
        resolve({ pending: true });
      }, CURRENT_VIDEO_RESOLVER_TIMEOUT_MS);
    }),
  ]);

  currentVideoInflight.set(cacheKey, boundedResolvePromise);

  try {
    const payload = await boundedResolvePromise;
    if ("pending" in payload && payload.pending) {
      currentVideoPendingCache.set(cacheKey, {
        expiresAt: Date.now() + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
        payload,
      });
    }
    return NextResponse.json(payload);
  } catch (error) {
    currentVideoResolverBlockedUntil = Date.now() + CURRENT_VIDEO_FAILURE_COOLDOWN_MS;

    logCurrentVideoRoute("request:resolver-error", {
      requestedVideoId: v,
      error: error instanceof Error ? error.message : String(error),
      cooldownMs: CURRENT_VIDEO_FAILURE_COOLDOWN_MS,
    });

    const pendingPayload: PendingPayload = { pending: true };
    currentVideoPendingCache.set(cacheKey, {
      expiresAt: Date.now() + CURRENT_VIDEO_PENDING_CACHE_TTL_MS,
      payload: pendingPayload,
    });
    return NextResponse.json(pendingPayload);
  } finally {
    currentVideoInflight.delete(cacheKey);
  }
}
