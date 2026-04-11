import { NextRequest, NextResponse } from "next/server";

import { getCurrentVideo, getNewestVideos, getRelatedVideos, getTopVideos, getUnseenCatalogVideos, getVideoPlaybackDecision, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";

const CURRENT_VIDEO_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";
const CURRENT_VIDEO_CACHE_TTL_MS = 20_000;
const CURRENT_VIDEO_FAILURE_COOLDOWN_MS = 8_000;
const CURRENT_VIDEO_PENDING_CACHE_TTL_MS = 2_000;
const CURRENT_VIDEO_RESOLVER_TIMEOUT_MS = 2_500;
const CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS = 1;
const CURRENT_VIDEO_RELATED_POOL_CACHE_TTL_MS = 30_000;
const CURRENT_VIDEO_RELATED_POOL_SIZE = 100;

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

const currentVideoCache = new Map<string, { expiresAt: number; payload: CurrentVideoPayload }>();
const currentVideoPendingCache = new Map<string, { expiresAt: number; payload: PendingPayload }>();
const currentVideoInflight = new Map<string, Promise<CurrentVideoResolvePayload>>();
const currentVideoRelatedPoolCache = new Map<string, { expiresAt: number; videos: Awaited<ReturnType<typeof getRelatedVideos>> }>();
const currentVideoRelatedPoolInflight = new Map<string, Promise<Awaited<ReturnType<typeof getRelatedVideos>>>>();
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

function logCurrentVideoRoute(event: string, detail?: Record<string, unknown>) {
  if (!CURRENT_VIDEO_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[current-video-route] ${event}${payload}`);
}

async function getRelatedPoolForCurrentVideo(currentVideoId: string, userId?: number) {
  const cacheKey = `${currentVideoId}:u:${userId ?? 0}`;
  const now = Date.now();
  const cached = currentVideoRelatedPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.videos;
  }

  const inFlight = currentVideoRelatedPoolInflight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    const baseRelated = await getRelatedVideos(currentVideoId, {
      userId,
      count: CURRENT_VIDEO_RELATED_POOL_SIZE,
    });

    const deduped = uniqueVideosById(baseRelated).filter((video) => video.id !== currentVideoId);
    const blockedIds = new Set<string>([currentVideoId, ...deduped.map((video) => video.id)]);
    if (deduped.length >= CURRENT_VIDEO_RELATED_POOL_SIZE) {
      return deduped.slice(0, CURRENT_VIDEO_RELATED_POOL_SIZE);
    }

    const [topCandidates, newestCandidates, unseenCandidates] = await Promise.all([
      getTopVideos(300),
      getNewestVideos(200, 0),
      getUnseenCatalogVideos({
        userId,
        count: 400,
        excludeVideoIds: Array.from(blockedIds),
      }),
    ]);

    const merged = uniqueVideosById([
      ...deduped,
      ...topCandidates,
      ...newestCandidates,
      ...unseenCandidates,
    ]).filter((video) => !blockedIds.has(video.id));

    return [...deduped, ...merged].slice(0, CURRENT_VIDEO_RELATED_POOL_SIZE);
  })();
  currentVideoRelatedPoolInflight.set(cacheKey, pending);

  try {
    const videos = await pending;
    currentVideoRelatedPoolCache.set(cacheKey, {
      expiresAt: Date.now() + CURRENT_VIDEO_RELATED_POOL_CACHE_TTL_MS,
      videos,
    });
    return videos;
  } finally {
    if (currentVideoRelatedPoolInflight.get(cacheKey) === pending) {
      currentVideoRelatedPoolInflight.delete(cacheKey);
    }
  }
}

export async function GET(request: NextRequest) {
  const v = request.nextUrl.searchParams.get("v") ?? undefined;
  const requestedRelatedCount = Math.max(
    1,
    Math.min(30, Number.parseInt(request.nextUrl.searchParams.get("count") ?? "10", 10) || 10),
  );
  const requestedRelatedOffset = Math.max(
    0,
    Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0,
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

    if (usePagedRelatedPool) {
      const relatedPool = await getRelatedPoolForCurrentVideo(currentVideo.id, optionalAuth?.userId);
      const filteredPool = excludedRelatedIds.length > 0
        ? relatedPool.filter((video) => !excludedRelatedIds.includes(video.id))
        : relatedPool;
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
      hasMoreForCustomRequest = fetchedRelatedVideos.length > requestedRelatedCount;
      relatedVideos = fetchedRelatedVideos.slice(0, requestedRelatedCount);
    }

    const targetRelatedCount = 10;
    let paddedRelatedVideos = relatedVideos;

    if (!isCustomRelatedRequest && relatedVideos.length < targetRelatedCount) {
      const topVideos = await getTopVideos(30);
      const blockedIds = new Set([currentVideo.id, ...relatedVideos.map((video) => video.id)]);
      const fillerPool = uniqueVideosById(topVideos.filter((video) => !blockedIds.has(video.id)));
      const filler = shuffleVideos(fillerPool).slice(0, targetRelatedCount - relatedVideos.length);
      paddedRelatedVideos = [...relatedVideos, ...filler];
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
