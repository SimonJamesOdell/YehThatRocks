import { getNewestVideosForRandom, getTopVideos } from "@/lib/catalog-data";
import type { VideoRecord } from "@/lib/catalog";
import { NEWEST_RANDOM_POOL_SIZE } from "@/lib/video-constants";

const TOP_VIDEOS_CACHE_TTL_MS = 60_000;

let cachedTopVideos: VideoRecord[] | null = null;
let cachedTopVideosExpiresAt = 0;
let topVideosRefreshPromise: Promise<VideoRecord[]> | null = null;
let topVideosRefreshCount = 0;

let cachedNewestVideos: VideoRecord[] | null = null;
let cachedNewestVideosExpiresAt = 0;
let newestVideosRefreshPromise: Promise<VideoRecord[]> | null = null;
let newestVideosRefreshCount = 0;

export function invalidateTopVideosCache() {
  cachedTopVideos = null;
  cachedTopVideosExpiresAt = 0;
  topVideosRefreshPromise = null;
  topVideosRefreshCount = 0;
  cachedNewestVideos = null;
  cachedNewestVideosExpiresAt = 0;
  newestVideosRefreshPromise = null;
  newestVideosRefreshCount = 0;
}

function uniqueVideosById(videos: VideoRecord[]) {
  const seen = new Set<string>();
  const unique: VideoRecord[] = [];

  for (const video of videos) {
    if (seen.has(video.id)) {
      continue;
    }

    seen.add(video.id);
    unique.push(video);
  }

  return unique;
}

function getRefreshPromise(count: number) {
  const safeCount = Math.max(count, 100);
  const cached = getCachedTopVideos(safeCount);

  if (cached) {
    return Promise.resolve(cached);
  }

  if (topVideosRefreshPromise && topVideosRefreshCount >= safeCount) {
    return topVideosRefreshPromise;
  }

  const refreshCount = Math.max(count, 100);
  const refreshPromise = topVideosRefreshPromise = getTopVideos(Math.max(count, 100))
      .then((videos) => {
        cachedTopVideos = videos;
        cachedTopVideosExpiresAt = Date.now() + TOP_VIDEOS_CACHE_TTL_MS;
        return videos;
      })
      .finally(() => {
        if (topVideosRefreshPromise === refreshPromise) {
          topVideosRefreshPromise = null;
          topVideosRefreshCount = 0;
        }
      });

  topVideosRefreshCount = refreshCount;
  return topVideosRefreshPromise;
}

export function getCachedTopVideos(count: number) {
  const now = Date.now();
  if (!cachedTopVideos || cachedTopVideosExpiresAt <= now || cachedTopVideos.length < count) {
    return null;
  }

  return cachedTopVideos.slice(0, count);
}

export async function getTopVideosFast(count: number, waitMs: number) {
  const cached = getCachedTopVideos(count);
  if (cached) {
    return cached;
  }

  try {
    const topVideosPromise = getRefreshPromise(count);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), waitMs),
    );
    const videos = await Promise.race([topVideosPromise, timeoutPromise]);
    return videos.slice(0, count);
  } catch {
    return cachedTopVideos?.slice(0, count) ?? [];
  }
}

export function warmTopVideos(count: number) {
  void getRefreshPromise(Math.max(count, 100));
}

// ── Newest video cache (random selection pool) ─────────────────────────────────

function getNewestRefreshPromise(count: number) {
  const safeCount = Math.max(count, NEWEST_RANDOM_POOL_SIZE);
  const cached = getCachedNewestVideos(safeCount);

  if (cached) {
    return Promise.resolve(cached);
  }

  if (newestVideosRefreshPromise && newestVideosRefreshCount >= safeCount) {
    return newestVideosRefreshPromise;
  }

  const refreshCount = Math.max(count, NEWEST_RANDOM_POOL_SIZE);
  const refreshPromise = newestVideosRefreshPromise = getNewestVideosForRandom(Math.max(count, NEWEST_RANDOM_POOL_SIZE))
      .then((videos) => {
        cachedNewestVideos = videos;
        cachedNewestVideosExpiresAt = Date.now() + TOP_VIDEOS_CACHE_TTL_MS;
        return videos;
      })
      .finally(() => {
        if (newestVideosRefreshPromise === refreshPromise) {
          newestVideosRefreshPromise = null;
          newestVideosRefreshCount = 0;
        }
      });

  newestVideosRefreshCount = refreshCount;
  return newestVideosRefreshPromise;
}

export function getCachedNewestVideos(count: number) {
  const now = Date.now();
  if (!cachedNewestVideos || cachedNewestVideosExpiresAt <= now || cachedNewestVideos.length < count) {
    return null;
  }

  return cachedNewestVideos.slice(0, count);
}

async function getNewestVideosFast(count: number, waitMs: number) {
  const cached = getCachedNewestVideos(count);
  if (cached) {
    return cached;
  }

  try {
    const newestPromise = getNewestRefreshPromise(count);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), waitMs),
    );
    const videos = await Promise.race([newestPromise, timeoutPromise]);
    return videos.slice(0, count);
  } catch {
    return cachedNewestVideos?.slice(0, count) ?? [];
  }
}

function warmNewestVideos(count: number) {
  void getNewestRefreshPromise(Math.max(count, NEWEST_RANDOM_POOL_SIZE));
}

export async function getRandomTopVideo(options?: { excludeVideoId?: string; relatedCount?: number; waitMs?: number }) {
  const excludeVideoId = options?.excludeVideoId?.trim() || undefined;
  const relatedCount = Math.max(0, Math.min(options?.relatedCount ?? 24, 99));
  const waitMs = Math.max(120, Math.min(options?.waitMs ?? 900, 2_000));

  let pool = getCachedNewestVideos(NEWEST_RANDOM_POOL_SIZE);
  if (!pool) {
    // Warm in background; callers can keep showing loading state until canonical data arrives.
    warmNewestVideos(NEWEST_RANDOM_POOL_SIZE);
    pool = await getNewestVideosFast(NEWEST_RANDOM_POOL_SIZE, waitMs);
  }

  if (pool.length === 0) {
    return {
      selected: null,
      relatedVideos: [] as VideoRecord[],
    };
  }

  const eligible =
    excludeVideoId && pool.length > 1
      ? pool.filter((video) => video.id !== excludeVideoId)
      : pool;

  const selected = eligible[Math.floor(Math.random() * eligible.length)] ?? pool[0];
  const relatedVideos = uniqueVideosById(pool.filter((video) => video.id !== selected.id)).slice(0, relatedCount);

  return { selected, relatedVideos };
}
