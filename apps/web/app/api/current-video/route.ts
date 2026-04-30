import { NextRequest, NextResponse } from "next/server";

import { pruneMapToMaxEntries } from "@/lib/bounded-map";
import { getCurrentVideo, getFavouriteVideos, getHiddenVideoIdsForUser, getNewestVideos, getRelatedVideos, getSeenVideoIdsForUser, getTopVideos, getUnseenCatalogVideos, getVideoPlaybackDecision, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
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
  blendRelatedWithFavourites,
  createSeededRandom,
  hashSeed,
  injectSparseFavourites,
  interleaveVideoBuckets,
  limitFavouritesInHead,
  pickBatchSourceVideos,
  shuffleVideos,
  shuffleWithRandom,
  uniqueVideosById,
} from "@/lib/current-video-route-utils";
import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
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
const RANDOM_CATALOG_MAX_ID_CACHE_TTL_MS = 60_000;
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

type CurrentVideoPayload = {
  currentVideo: Awaited<ReturnType<typeof getCurrentVideo>>;
  relatedVideos: Awaited<ReturnType<typeof getRelatedVideos>>;
  hasMore?: boolean;
};

type PendingPayload = {
  pending: true;
  denied?: { videoId: string; reason: string; message: string };
};

type CurrentVideoResolvePayload = CurrentVideoPayload | PendingPayload;
type WatchNextVideo = Awaited<ReturnType<typeof getRelatedVideos>>[number];
type WatchNextStreamCacheEntry = {
  expiresAt: number;
  videos: WatchNextVideo[];
  hasMore: boolean;
};

let currentVideoResolverBlockedUntil = 0;
const watchNextStreamCache = new Map<string, WatchNextStreamCacheEntry>();
const watchNextStreamInflight = new Map<string, Promise<WatchNextStreamCacheEntry>>();
let randomCatalogMaxIdCache:
  | {
      expiresAt: number;
      maxId: number;
    }
  | undefined;
let randomCatalogMaxIdInFlight: Promise<number> | undefined;

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

async function getAvailableRandomCatalogMaxId() {
  const now = Date.now();
  if (randomCatalogMaxIdCache && randomCatalogMaxIdCache.expiresAt > now) {
    return randomCatalogMaxIdCache.maxId;
  }

  if (randomCatalogMaxIdInFlight) {
    return randomCatalogMaxIdInFlight;
  }

  const resolveMaxId = prisma.$queryRaw<Array<{ maxId: number | null }>>`
    SELECT MAX(v.id) AS maxId
    FROM videos v
    WHERE v.videoId IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      )
  `
    .then((rows) => {
      const maxId = Number(rows[0]?.maxId ?? 0);
      const normalizedMaxId = Number.isFinite(maxId) ? maxId : 0;
      randomCatalogMaxIdCache = {
        expiresAt: Date.now() + RANDOM_CATALOG_MAX_ID_CACHE_TTL_MS,
        maxId: normalizedMaxId,
      };
      return normalizedMaxId;
    })
    .finally(() => {
      if (randomCatalogMaxIdInFlight === resolveMaxId) {
        randomCatalogMaxIdInFlight = undefined;
      }
    });

  randomCatalogMaxIdInFlight = resolveMaxId;
  return resolveMaxId;
}

async function getRandomCatalogVideosForCurrentVideo(currentVideoId: string, count: number) {
  const requested = Math.max(1, Math.min(2_000, Math.floor(count)));
  const maxId = await getAvailableRandomCatalogMaxId();
  if (!Number.isFinite(maxId) || maxId <= 0) {
    return [];
  }

  const randomStartId = Math.max(1, Math.floor(Math.random() * maxId));
  const queryLimit = Math.max(80, requested * 2);
  const selectSql = `
    SELECT
      v.id AS dbId,
      v.videoId AS id,
      v.title AS title,
      COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), ''), NULL) AS channelTitle,
      COALESCE(v.favourited, 0) AS favourited,
      v.description AS description
    FROM videos v
    WHERE v.videoId IS NOT NULL
      AND v.videoId <> ?
      AND v.id >= ?
      AND EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      )
    ORDER BY v.id ASC
    LIMIT ?
  `;

  const wrapSql = `
    SELECT
      v.id AS dbId,
      v.videoId AS id,
      v.title AS title,
      COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), ''), NULL) AS channelTitle,
      COALESCE(v.favourited, 0) AS favourited,
      v.description AS description
    FROM videos v
    WHERE v.videoId IS NOT NULL
      AND v.videoId <> ?
      AND v.id < ?
      AND EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      )
    ORDER BY v.id ASC
    LIMIT ?
  `;

  const firstRows = await prisma.$queryRawUnsafe<Array<{
    dbId: number;
    id: string;
    title: string;
    channelTitle: string | null;
    favourited: number | null;
    description: string | null;
  }>>(selectSql, currentVideoId, randomStartId, queryLimit);

  const remaining = Math.max(0, queryLimit - firstRows.length);
  const wrapRows = remaining > 0
    ? await prisma.$queryRawUnsafe<Array<{
      dbId: number;
      id: string;
      title: string;
      channelTitle: string | null;
      favourited: number | null;
      description: string | null;
    }>>(wrapSql, currentVideoId, randomStartId, remaining)
    : [];
  const rows = uniqueVideosById([...firstRows, ...wrapRows]).slice(0, requested);

  const repairedArtists = rows
    .map((row) => {
      const normalizedCurrentArtist = (row.channelTitle ?? "").trim().toLowerCase();
      const hasMeaningfulArtist = Boolean(normalizedCurrentArtist) && !GENERIC_ARTIST_LABELS.has(normalizedCurrentArtist);
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
    const resolvedArtist = row.channelTitle?.trim() && !GENERIC_ARTIST_LABELS.has(normalizedCurrentArtist)
      ? row.channelTitle.trim()
      : inferredArtist || "Unknown Artist";

    return ({
    id: row.id,
    title: row.title,
    channelTitle: resolvedArtist,
    genre: "",
    favourited: Number(row.favourited ?? 0),
    description: row.description ?? "",
    });
  });
}

async function buildWatchNextRelatedStream(params: {
  currentVideoId: string;
  userId?: number;
  offset: number;
  count: number;
  blockedIds: Set<string>;
  favouriteVideos: WatchNextVideo[];
}) {
  const targetCount = Math.max(1, params.count);
  const targetTotal = params.offset + targetCount;
  const seedBase = `${params.currentVideoId}:u:${params.userId ?? 0}:o:${params.offset}:c:${params.count}`;

  const [topPoolRaw, newestPoolRaw, randomPoolRaw] = await Promise.all([
    getCachedTopVideosForCurrentVideo(WATCH_NEXT_TOP_POOL_SIZE),
    getNewestVideos(WATCH_NEXT_NEWEST_POOL_SIZE, 0),
    getRandomCatalogVideosForCurrentVideo(
      params.currentVideoId,
      Math.max(WATCH_NEXT_RANDOM_POOL_MIN, targetTotal + WATCH_NEXT_BATCH_SIZE * 2),
    ),
  ]);

  const removeBlocked = (videos: WatchNextVideo[]) => videos.filter((video) => !params.blockedIds.has(video.id));
  const topPool = removeBlocked(topPoolRaw);
  const newestPool = removeBlocked(newestPoolRaw);
  const randomPool = removeBlocked(randomPoolRaw);
  const favouritePool = removeBlocked(params.favouriteVideos);

  const globalUsedIds = new Set(params.blockedIds);
  const stream: WatchNextVideo[] = [];
  let batchNumber = 0;
  let canContinue = true;

  while (stream.length < targetTotal && canContinue && batchNumber < 200) {
    const batchBlockedIds = new Set(globalUsedIds);
    const batchRandom = createSeededRandom(`${seedBase}:batch:${batchNumber}`);

    const favourites = pickBatchSourceVideos({
      source: favouritePool,
      count: WATCH_NEXT_SOURCE_SLICE_SIZE,
      blockedIds: batchBlockedIds,
      random: batchRandom,
      labels: { isFavouriteSource: true },
    });
    const top = pickBatchSourceVideos({
      source: topPool,
      count: WATCH_NEXT_SOURCE_SLICE_SIZE,
      blockedIds: batchBlockedIds,
      random: batchRandom,
      labels: { isTop100Source: true, sourceLabel: "Top100" },
    });
    const newest = pickBatchSourceVideos({
      source: newestPool,
      count: WATCH_NEXT_SOURCE_SLICE_SIZE,
      blockedIds: batchBlockedIds,
      random: batchRandom,
      labels: { isNewSource: true, sourceLabel: "New" },
    });
    const randoms = pickBatchSourceVideos({
      source: randomPool,
      count: WATCH_NEXT_SOURCE_SLICE_SIZE,
      blockedIds: batchBlockedIds,
      random: batchRandom,
    });

    let batch = [...favourites, ...top, ...newest, ...randoms];

    if (batch.length < WATCH_NEXT_BATCH_SIZE) {
      const topOff = pickBatchSourceVideos({
        source: interleaveVideoBuckets([randomPool, newestPool, topPool]),
        count: WATCH_NEXT_BATCH_SIZE - batch.length,
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

function getWatchNextStreamCacheKey(params: {
  currentVideoId: string;
  userId?: number;
  blockedIds: Set<string>;
}) {
  const blockedSignature = hashSeed(Array.from(params.blockedIds).sort().join("|")).toString(16);
  return `${params.currentVideoId}:u:${params.userId ?? 0}:blocked:${blockedSignature}`;
}

async function getWatchNextStreamSlice(params: {
  currentVideoId: string;
  userId?: number;
  offset: number;
  count: number;
  blockedIds: Set<string>;
  favouriteVideos: WatchNextVideo[];
}) {
  pruneCurrentVideoRouteCaches();

  const cacheKey = getWatchNextStreamCacheKey({
    currentVideoId: params.currentVideoId,
    userId: params.userId,
    blockedIds: params.blockedIds,
  });
  const now = Date.now();
  const requiredSize = Math.max(
    WATCH_NEXT_BATCH_SIZE,
    params.offset + params.count + WATCH_NEXT_BATCH_SIZE,
  );
  const cached = watchNextStreamCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    const hasRequiredRows = cached.videos.length >= requiredSize;
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

  const inFlight = watchNextStreamInflight.get(cacheKey);
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
    requiredSize,
    (cached?.videos.length ?? 0) + WATCH_NEXT_BATCH_SIZE,
  );

  const pending = (async () => {
    const stream = await buildWatchNextRelatedStream({
      currentVideoId: params.currentVideoId,
      userId: params.userId,
      offset: 0,
      count: targetCount,
      blockedIds: new Set(params.blockedIds),
      favouriteVideos: params.favouriteVideos,
    });

    const entry: WatchNextStreamCacheEntry = {
      expiresAt: Date.now() + WATCH_NEXT_STREAM_CACHE_TTL_MS,
      videos: stream.videos,
      hasMore: stream.hasMore,
    };
    watchNextStreamCache.set(cacheKey, entry);
    return entry;
  })();

  watchNextStreamInflight.set(cacheKey, pending);

  try {
    const entry = await pending;
    const start = Math.min(params.offset, entry.videos.length);
    const end = Math.min(entry.videos.length, start + params.count);
    return {
      videos: entry.videos.slice(start, end),
      hasMore: end < entry.videos.length || entry.hasMore,
    };
  } finally {
    if (watchNextStreamInflight.get(cacheKey) === pending) {
      watchNextStreamInflight.delete(cacheKey);
    }
  }
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
  const shouldFilterSeen = hideSeenOnly && Boolean(optionalAuth?.userId);
  const favouriteBlendRatio = requestMode === "ended-choice"
    ? ENDED_CHOICE_FAVOURITE_BLEND_RATIO
    : WATCH_NEXT_FAVOURITE_BLEND_RATIO;
  const preferUnseenForEndedChoice = requestMode === "ended-choice" && hideSeenOnly && Boolean(optionalAuth?.userId);
  const favouriteVideosPromise = optionalAuth?.userId
    ? getFavouriteVideos(optionalAuth.userId)
    : Promise.resolve([] as Awaited<ReturnType<typeof getFavouriteVideos>>);
  const cacheKey = `${v ?? "__default__"}:u:${optionalAuth?.userId ?? 0}:hideSeen:${hideSeenOnly ? 1 : 0}`;
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

  const resolvePayloadPromise = (async () => {
    let seenVideoIdsForRequest: Set<string> | null = null;
    let hiddenVideoIdsForRequest: Set<string> | null = null;
    const getSeenVideoIdsForRequest = async () => {
      if (!shouldFilterSeen || !optionalAuth?.userId) {
        return null;
      }

      if (!seenVideoIdsForRequest) {
        seenVideoIdsForRequest = await getSeenVideoIdsForUser(optionalAuth.userId);
      }

      return seenVideoIdsForRequest;
    };
    const getHiddenVideoIdsForRequest = async () => {
      if (!optionalAuth?.userId) {
        return null;
      }

      if (!hiddenVideoIdsForRequest) {
        hiddenVideoIdsForRequest = await getHiddenVideoIdsForUser(optionalAuth.userId);
      }

      return hiddenVideoIdsForRequest;
    };

    if (v) {
      const decision = await getVideoPlaybackDecision(v);
      logCurrentVideoRoute("request:decision", {
        requestedVideoId: v,
        allowed: decision.allowed,
        reason: decision.reason,
      });

      if (!decision.allowed) {
        if (decision.reason === "unavailable") {
          await pruneVideoAndAssociationsByVideoId(v, "api-current-video-denied-unavailable").catch(() => undefined);
        }
        logCurrentVideoRoute("request:denied", {
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
      logCurrentVideoRoute("request:pending", {
        requestedVideoId: v,
      });

      return { pending: true as const };
    }

    let relatedVideos: Awaited<ReturnType<typeof getRelatedVideos>> = [];
    let hasMoreForCustomRequest: boolean | undefined;
    let earlyTopVideosForPadding: Awaited<ReturnType<typeof getCachedTopVideosForCurrentVideo>> | undefined;
    const favouriteVideos = await favouriteVideosPromise;
    const favouriteVideoIdSet = new Set(favouriteVideos.map((video) => video.id));
    const allowFavouriteSeenBypass = requestMode !== "ended-choice";

    if (useUnifiedWatchNextPool) {
      const hiddenVideoIds = await getHiddenVideoIdsForRequest();
      const blockedIds = new Set<string>([currentVideo.id, ...excludedRelatedIds]);

      if (hiddenVideoIds && hiddenVideoIds.size > 0) {
        for (const videoId of hiddenVideoIds) {
          blockedIds.add(videoId);
        }
      }

      const { videos, hasMore } = await getWatchNextStreamSlice({
        currentVideoId: currentVideo.id,
        userId: optionalAuth?.userId,
        offset: requestedRelatedOffset,
        count: requestedRelatedCount,
        blockedIds,
        favouriteVideos,
      });

      relatedVideos = videos;
      hasMoreForCustomRequest = hasMore;
    } else if (usePagedRelatedPool) {
      const poolSizeTarget = requestMode === "ended-choice"
        ? Math.max(48, requestedRelatedOffset + requestedRelatedCount + 24)
        : Math.max(48, requestedRelatedOffset + requestedRelatedCount + 24);
      const relatedPool = await getRelatedPoolForCurrentVideo(
        currentVideo.id,
        optionalAuth?.userId,
        poolSizeTarget,
        favouriteVideos,
        await getHiddenVideoIdsForRequest(),
      );
      let filteredPool = excludedRelatedIds.length > 0
        ? relatedPool.filter((video) => !excludedRelatedIds.includes(video.id))
        : relatedPool;

      if (preferUnseenForEndedChoice && optionalAuth?.userId) {
        const seenVideoIds = await getSeenVideoIdsForUser(optionalAuth.userId);
        seenVideoIdsForRequest = seenVideoIds;
        const unseenBoost = await getUnseenCatalogVideos({
          userId: optionalAuth.userId,
          count: Math.max(300, Math.min(CURRENT_VIDEO_RELATED_POOL_QUERY_EXPANSION_CAP, poolSizeTarget)),
          excludeVideoIds: [currentVideo.id, ...excludedRelatedIds],
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
        favouriteBlendRatio,
      );

      if (shouldFilterSeen) {
        const seenVideoIds = await getSeenVideoIdsForRequest();
        if (seenVideoIds) {
          filteredPool = filteredPool.filter((video) => !seenVideoIds.has(video.id));
        }
      }

      const start = Math.min(requestedRelatedOffset, filteredPool.length);
      const end = Math.min(filteredPool.length, start + requestedRelatedCount);
      relatedVideos = filteredPool.slice(start, end);
      hasMoreForCustomRequest = end < filteredPool.length;
    } else {
      const requestedWithProbe = Math.min(30, requestedRelatedCount + 1);
      // Start top-video prefetch in parallel so padding is zero-cost if the
      // related set comes back smaller than the target batch size.
      const paddingTopVideosPromise = getCachedTopVideosForCurrentVideo(30);
      const fetchedRelatedVideos = await getRelatedVideos(currentVideo.id, {
        userId: optionalAuth?.userId,
        count: requestedWithProbe,
        excludeVideoIds: excludedRelatedIds,
      });
      earlyTopVideosForPadding = await paddingTopVideosPromise;
      const blendedRelatedVideos = blendRelatedWithFavourites(
        fetchedRelatedVideos,
        favouriteVideos,
        currentVideo.id,
        favouriteBlendRatio,
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
      hasMoreForCustomRequest = visibleRelatedVideos.length > requestedRelatedCount;
      relatedVideos = visibleRelatedVideos.slice(0, requestedRelatedCount);
    }

    const targetRelatedCount = 8;
    let paddedRelatedVideos = relatedVideos;

    if (!isCustomRelatedRequest && relatedVideos.length < targetRelatedCount) {
      const topVideos = earlyTopVideosForPadding ?? await getCachedTopVideosForCurrentVideo(30);
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
      const filler = shuffleVideos(fillerPool).slice(0, targetRelatedCount - relatedVideos.length);
      paddedRelatedVideos = [...relatedVideos, ...filler];
    }

    // Final hidden-video filtering should reuse the request-scoped hidden id set.
    if (optionalAuth?.userId) {
      const hiddenVideoIds = await getHiddenVideoIdsForRequest();
      if (hiddenVideoIds && hiddenVideoIds.size > 0) {
        paddedRelatedVideos = paddedRelatedVideos.filter((video) => !hiddenVideoIds.has(video.id));
      }
    }

    const normalizedPayload: CurrentVideoPayload = {
      currentVideo,
      relatedVideos: paddedRelatedVideos,
      hasMore: isCustomRelatedRequest ? hasMoreForCustomRequest : undefined,
    };

    if (!isCustomRelatedRequest) {
      currentVideoCache.set(cacheKey, {
        expiresAt: Date.now() + CURRENT_VIDEO_CACHE_TTL_MS,
        payload: normalizedPayload,
      });
    }

    if (!isCustomRelatedRequest) {
      currentVideoResolverBlockedUntil = 0;
    }

    // Pre-warm the related pool for this video so the client's first background
    // prefetch joins an in-flight pool build rather than cold-starting it
    // (cuts Watch Next fill latency from several seconds to near-zero on warm cache).
    if (!isCustomRelatedRequest) {
      getRelatedPoolForCurrentVideo(
        currentVideo.id,
        optionalAuth?.userId,
        CURRENT_VIDEO_RELATED_POOL_SIZE,
      ).catch(() => undefined);
    }

    logCurrentVideoRoute("request:success", {
      requestedVideoId: v,
      resolvedVideoId: currentVideo.id,
      relatedCount: paddedRelatedVideos.length,
    });

    return normalizedPayload;
  })();

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
