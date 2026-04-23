import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, getCurrentVideo, getFavouriteVideos, getNewestVideos, getRelatedVideos, getTopVideos, getUnseenCatalogVideos, getVideoPlaybackDecision, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";
import {
  currentVideoCache,
  currentVideoInflight,
  currentVideoPendingCache,
  currentVideoRelatedPoolCache,
  currentVideoRelatedPoolInflight,
} from "@/lib/current-video-cache";
import { getTopVideosFast, warmTopVideos } from "@/lib/top-videos-cache";

const CURRENT_VIDEO_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";
const CURRENT_VIDEO_CACHE_TTL_MS = 20_000;
const CURRENT_VIDEO_FAILURE_COOLDOWN_MS = 8_000;
const CURRENT_VIDEO_PENDING_CACHE_TTL_MS = 2_000;
const CURRENT_VIDEO_RESOLVER_TIMEOUT_MS = 2_500;
const CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS = 1;
const CURRENT_VIDEO_RELATED_POOL_CACHE_TTL_MS = 30_000;
const CURRENT_VIDEO_RELATED_POOL_SIZE = 100;
const CURRENT_VIDEO_RELATED_POOL_BASE_SIZE = CURRENT_VIDEO_RELATED_POOL_SIZE;
const CURRENT_VIDEO_RELATED_POOL_MAX_SIZE = 300_000;
const CURRENT_VIDEO_RELATED_POOL_QUERY_EXPANSION_CAP = 5_000;
const CURRENT_VIDEO_RELATED_OFFSET_MAX = 5_000;
const WATCH_NEXT_FAVOURITE_BLEND_RATIO = 0.3;
const ENDED_CHOICE_FAVOURITE_BLEND_RATIO = 0.45;
const CURRENT_VIDEO_TOP_CACHE_WAIT_MS = 1_200;

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

let currentVideoResolverBlockedUntil = 0;

function shuffleVideos<T>(rows: T[]) {
  const shuffled = [...rows];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[randomIndex];
    shuffled[randomIndex] = current;
  }

  return shuffled;
}

function uniqueVideosById<T extends { id: string }>(rows: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    unique.push(row);
  }

  return unique;
}

function blendRelatedWithFavourites<T extends { id: string }>(
  baseVideos: T[],
  favouriteVideos: T[],
  currentVideoId: string,
  favouriteRatio: number,
) {
  if (favouriteVideos.length === 0 || favouriteRatio <= 0) {
    return uniqueVideosById(baseVideos).filter((video) => video.id !== currentVideoId);
  }

  const preferred = uniqueVideosById(favouriteVideos).filter((video) => video.id !== currentVideoId);
  if (preferred.length === 0) {
    return uniqueVideosById(baseVideos).filter((video) => video.id !== currentVideoId);
  }

  const preferredIds = new Set(preferred.map((video) => video.id));
  const discovery = uniqueVideosById(baseVideos).filter(
    (video) => video.id !== currentVideoId && !preferredIds.has(video.id),
  );

  const blend = Math.max(0.05, Math.min(0.95, favouriteRatio));
  const nonPreferredPerPreferred = Math.max(1, Math.round((1 - blend) / blend));
  let nonPreferredSincePreferred = Math.max(0, nonPreferredPerPreferred - 1);
  let preferredIndex = 0;
  let discoveryIndex = 0;
  const mixed: T[] = [];

  while (preferredIndex < preferred.length || discoveryIndex < discovery.length) {
    const shouldTakePreferred =
      preferredIndex < preferred.length
      && (nonPreferredSincePreferred >= nonPreferredPerPreferred || discoveryIndex >= discovery.length);

    if (shouldTakePreferred) {
      mixed.push(preferred[preferredIndex]);
      preferredIndex += 1;
      nonPreferredSincePreferred = 0;
      continue;
    }

    if (discoveryIndex < discovery.length) {
      mixed.push(discovery[discoveryIndex]);
      discoveryIndex += 1;
      nonPreferredSincePreferred += 1;
      continue;
    }

    if (preferredIndex < preferred.length) {
      mixed.push(preferred[preferredIndex]);
      preferredIndex += 1;
      nonPreferredSincePreferred = 0;
    }
  }

  return mixed;
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

async function getRelatedPoolForCurrentVideo(
  currentVideoId: string,
  userId: number | undefined,
  minimumSize: number,
  favouriteVideos?: Awaited<ReturnType<typeof getFavouriteVideos>>,
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
    const discoveryCount = Math.max(300, Math.min(CURRENT_VIDEO_RELATED_POOL_QUERY_EXPANSION_CAP, targetSize * 2));
    const baseRelated = await getRelatedVideos(currentVideoId, {
      userId,
      count: 120,
    });

    const deduped = uniqueVideosById(baseRelated).filter((video) => video.id !== currentVideoId);
    const blockedIds = new Set<string>([currentVideoId, ...deduped.map((video) => video.id)]);
    if (deduped.length >= targetSize) {
      return deduped.slice(0, targetSize);
    }

    const topPromise = discoveryCount > 300
      ? getCachedTopVideosForCurrentVideo(discoveryCount)
      : getTopVideos(300);
    const newestPromise = discoveryCount > 300
      ? getNewestVideos(discoveryCount, 0)
      : getNewestVideos(200, 0);

    const [topCandidates, newestCandidates, unseenCandidates, favouriteCandidates] = await Promise.all([
      topPromise,
      newestPromise,
      getUnseenCatalogVideos({
        userId,
        count: Math.min(500, Math.max(200, Math.floor(targetSize / 2))),
        excludeVideoIds: Array.from(blockedIds),
      }),
      favouriteVideos ? Promise.resolve(favouriteVideos) : userId ? getFavouriteVideos(userId) : Promise.resolve([]),
    ]);

    const merged = uniqueVideosById([
      ...deduped,
      ...unseenCandidates,
      ...topCandidates,
      ...newestCandidates,
    ]).filter((video) => !blockedIds.has(video.id));

    const slicedMergedPool = sliceMergedRelatedPool(deduped, merged, targetSize);
    const blended = blendRelatedWithFavourites(
      slicedMergedPool,
      favouriteCandidates,
      currentVideoId,
      WATCH_NEXT_FAVOURITE_BLEND_RATIO,
    );
    return blended.slice(0, slicedMergedPool.length);
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
  const requestedRelatedCount = Math.max(
    1,
    Math.min(30, Number.parseInt(request.nextUrl.searchParams.get("count") ?? "10", 10) || 10),
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
  const optionalAuth = await getOptionalApiAuth(request);
  const favouriteBlendRatio = requestMode === "ended-choice"
    ? ENDED_CHOICE_FAVOURITE_BLEND_RATIO
    : WATCH_NEXT_FAVOURITE_BLEND_RATIO;
  const preferUnseenForEndedChoice = requestMode === "ended-choice" && hideSeenOnly && Boolean(optionalAuth?.userId);
  const favouriteVideosPromise = optionalAuth?.userId
    ? getFavouriteVideos(optionalAuth.userId)
    : Promise.resolve([] as Awaited<ReturnType<typeof getFavouriteVideos>>);
  const cacheKey = `${v ?? "__default__"}:u:${optionalAuth?.userId ?? 0}`;
  const now = Date.now();

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
    const favouriteVideos = await favouriteVideosPromise;

    if (usePagedRelatedPool) {
      const poolSizeTarget = requestMode === "ended-choice"
        ? Math.max(1000, requestedRelatedOffset + requestedRelatedCount + 1)
        : requestedRelatedOffset + requestedRelatedCount + 1;
      const relatedPool = await getRelatedPoolForCurrentVideo(
        currentVideo.id,
        optionalAuth?.userId,
        poolSizeTarget,
        favouriteVideos,
      );
      let filteredPool = excludedRelatedIds.length > 0
        ? relatedPool.filter((video) => !excludedRelatedIds.includes(video.id))
        : relatedPool;

      if (preferUnseenForEndedChoice && optionalAuth?.userId) {
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

      const start = Math.min(requestedRelatedOffset, filteredPool.length);
      const end = Math.min(filteredPool.length, start + requestedRelatedCount);
      relatedVideos = filteredPool.slice(start, end);
      hasMoreForCustomRequest = end < filteredPool.length;
    } else {
      const requestedWithProbe = Math.min(30, requestedRelatedCount + 1);
      const fetchedRelatedVideos = await getRelatedVideos(currentVideo.id, {
        userId: optionalAuth?.userId,
        count: requestedWithProbe,
        excludeVideoIds: excludedRelatedIds,
      });
      const blendedRelatedVideos = blendRelatedWithFavourites(
        fetchedRelatedVideos,
        favouriteVideos,
        currentVideo.id,
        favouriteBlendRatio,
      );
      hasMoreForCustomRequest = blendedRelatedVideos.length > requestedRelatedCount;
      relatedVideos = blendedRelatedVideos.slice(0, requestedRelatedCount);
    }

    const targetRelatedCount = 8;
    let paddedRelatedVideos = relatedVideos;

    if (!isCustomRelatedRequest && relatedVideos.length < targetRelatedCount) {
      const topVideos = await getTopVideos(30);
      const blockedIds = new Set([currentVideo.id, ...relatedVideos.map((video) => video.id)]);
      const fillerPool = uniqueVideosById(topVideos.filter((video) => !blockedIds.has(video.id)));
      const filler = shuffleVideos(fillerPool).slice(0, targetRelatedCount - relatedVideos.length);
      paddedRelatedVideos = [...relatedVideos, ...filler];
    }

    // Filter out blocked videos for authenticated users
    if (optionalAuth) {
      paddedRelatedVideos = await filterHiddenVideos(paddedRelatedVideos, optionalAuth.userId);
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
