"use client";

import type { CategoryArtistCard } from "@/lib/catalog-data";

const CATEGORY_ARTISTS_SESSION_KEY_PREFIX = "ytr:categories:artists:first:v1:";
const CATEGORY_ARTISTS_FULL_KEY_PREFIX = "ytr:categories:artists:full:v1:";
const CATEGORY_ARTISTS_CACHE_EVENT = "ytr:category-artists-cache-updated";
const CATEGORY_ARTISTS_SESSION_TTL_MS = 30 * 60 * 1000;
const CATEGORY_ARTISTS_FULL_TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORY_ARTISTS_FULL_REVALIDATE_MS = 20 * 60 * 1000;
const FIRST_PAGE_LIMIT = 50;
const FULL_PAGE_LIMIT = 96;
const FULL_FETCH_CONCURRENCY = 2;
const FIRST_PAYLOAD_PREFETCH_CONCURRENCY = 2;
const PAGE_FETCH_ATTEMPTS = 3;
const PAGE_FETCH_RETRY_BASE_DELAY_MS = 140;

export type CategoryArtistsFirstPayload = {
  artists: CategoryArtistCard[];
  totalArtists: number | null;
  tabCounts: Record<string, number> | null;
  hasMore: boolean;
  nextOffset: number;
};

export type CategoryArtistsFullPayload = CategoryArtistsFirstPayload & {
  fetchedAt: number;
  lastCheckedAt: number;
};

const memoryFirstCache = new Map<string, { payload: CategoryArtistsFirstPayload; expiresAt: number }>();
const memoryFullCache = new Map<string, { payload: CategoryArtistsFullPayload; expiresAt: number }>();
const inFlightBySlug = new Map<string, Promise<CategoryArtistsFirstPayload | null>>();
const inFlightFullBySlug = new Map<string, Promise<CategoryArtistsFullPayload | null>>();

function normalizeSlug(slug?: string | null) {
  const normalizedSlug = slug?.trim().toLowerCase();
  return normalizedSlug || null;
}

function emitCategoryArtistsCacheEvent(slug: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(CATEGORY_ARTISTS_CACHE_EVENT, {
    detail: { slug },
  }));
}

function isCategoryArtistsPayload(value: unknown): value is CategoryArtistsFirstPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<CategoryArtistsFirstPayload>;
  return Array.isArray(payload.artists)
    && typeof payload.hasMore === "boolean"
    && Number.isFinite(Number(payload.nextOffset));
}

function isCategoryArtistsFullPayload(value: unknown): value is CategoryArtistsFullPayload {
  if (!isCategoryArtistsPayload(value)) {
    return false;
  }

  const payload = value as Partial<CategoryArtistsFullPayload>;
  return Number.isFinite(Number(payload.fetchedAt))
    && Number.isFinite(Number(payload.lastCheckedAt));
}

function isCompleteCategoryArtistsPayload(payload: Pick<CategoryArtistsFullPayload, "artists" | "totalArtists">) {
  if (typeof payload.totalArtists !== "number" || !Number.isFinite(payload.totalArtists)) {
    return true;
  }

  const expectedTotal = Math.max(0, Math.floor(payload.totalArtists));
  return payload.artists.length >= expectedTotal;
}

function getFirstPayloadKey(slug?: string | null) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  return `${CATEGORY_ARTISTS_SESSION_KEY_PREFIX}${normalizedSlug}`;
}

function getFullPayloadKey(slug?: string | null) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  return `${CATEGORY_ARTISTS_FULL_KEY_PREFIX}${normalizedSlug}`;
}

function normalizeArtists(artists: unknown) {
  if (!Array.isArray(artists)) {
    return [] as CategoryArtistCard[];
  }

  return artists.filter((artist): artist is CategoryArtistCard => {
    return Boolean(artist)
      && typeof artist === "object"
      && typeof (artist as CategoryArtistCard).slug === "string"
      && typeof (artist as CategoryArtistCard).name === "string"
      && typeof (artist as CategoryArtistCard).videoCount === "number";
  });
}

function mergeArtists(existing: CategoryArtistCard[], incoming: CategoryArtistCard[]) {
  if (incoming.length === 0) {
    return existing;
  }

  const seen = new Set(existing.map((artist) => artist.slug));
  const merged = [...existing];

  for (const artist of incoming) {
    if (seen.has(artist.slug)) {
      continue;
    }

    seen.add(artist.slug);
    merged.push(artist);
  }

  return merged;
}

async function fetchCategoryArtistsPage(slug: string, offset: number, limit: number, includeTabCounts = false) {
  const searchParams = new URLSearchParams();
  searchParams.set("limit", String(limit));
  searchParams.set("offset", String(offset));
  if (includeTabCounts) {
    searchParams.set("includeTabCounts", "1");
  }

  const response = await fetch(`/api/categories/${encodeURIComponent(slug)}/artists?${searchParams.toString()}`, {
    cache: "no-store",
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    artists?: CategoryArtistCard[];
    totalArtists?: number | null;
    tabCounts?: Record<string, number> | null;
    hasMore?: boolean;
    nextOffset?: number;
  };

  const artists = normalizeArtists(payload.artists);
  const nextOffset = Number(payload.nextOffset);

  return {
    artists,
    totalArtists: typeof payload.totalArtists === "number" && Number.isFinite(payload.totalArtists)
      ? payload.totalArtists
      : null,
    tabCounts: payload.tabCounts && typeof payload.tabCounts === "object" ? payload.tabCounts : null,
    hasMore: payload.hasMore === true,
    nextOffset: Number.isFinite(nextOffset) ? nextOffset : offset + artists.length,
  } as CategoryArtistsFirstPayload;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function fetchCategoryArtistsPageWithRetry(
  slug: string,
  offset: number,
  limit: number,
  includeTabCounts = false,
) {
  let attempt = 0;
  while (attempt < PAGE_FETCH_ATTEMPTS) {
    const payload = await fetchCategoryArtistsPage(slug, offset, limit, includeTabCounts);
    if (payload) {
      return payload;
    }

    attempt += 1;
    if (attempt >= PAGE_FETCH_ATTEMPTS) {
      return null;
    }

    const backoffMs = PAGE_FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    await sleep(backoffMs);
  }

  return null;
}

export function readCategoryArtistsFirstPayloadFromSessionCache(slug?: string | null): CategoryArtistsFirstPayload | null {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const now = Date.now();
  const memoryEntry = memoryFirstCache.get(normalizedSlug);
  if (memoryEntry && memoryEntry.expiresAt > now) {
    return memoryEntry.payload;
  }

  if (typeof window === "undefined") {
    return null;
  }

  const key = getFirstPayloadKey(normalizedSlug);
  if (!key) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { payload?: unknown; expiresAt?: unknown };
    const expiresAt = Number(parsed?.expiresAt ?? 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    if (!isCategoryArtistsPayload(parsed?.payload)) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    memoryFirstCache.set(normalizedSlug, { payload: parsed.payload, expiresAt });
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeCategoryArtistsFirstPayloadToSessionCache(slug?: string | null, payload?: CategoryArtistsFirstPayload) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug || !payload) {
    return;
  }

  const expiresAt = Date.now() + CATEGORY_ARTISTS_SESSION_TTL_MS;
  memoryFirstCache.set(normalizedSlug, { payload, expiresAt });

  if (typeof window !== "undefined") {
    const key = getFirstPayloadKey(normalizedSlug);
    if (key) {
      try {
        window.sessionStorage.setItem(key, JSON.stringify({ payload, expiresAt }));
      } catch {
        // Best effort only.
      }
    }
  }

  emitCategoryArtistsCacheEvent(normalizedSlug);
}

export function readCategoryArtistsFullPayloadFromCache(slug?: string | null): CategoryArtistsFullPayload | null {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const now = Date.now();
  const memoryEntry = memoryFullCache.get(normalizedSlug);
  if (memoryEntry && memoryEntry.expiresAt > now) {
    return memoryEntry.payload;
  }

  if (typeof window === "undefined") {
    return null;
  }

  const key = getFullPayloadKey(normalizedSlug);
  if (!key) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { payload?: unknown; expiresAt?: unknown };
    const expiresAt = Number(parsed?.expiresAt ?? 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      window.localStorage.removeItem(key);
      return null;
    }

    if (!isCategoryArtistsFullPayload(parsed?.payload)) {
      window.localStorage.removeItem(key);
      return null;
    }

    if (!isCompleteCategoryArtistsPayload(parsed.payload)) {
      window.localStorage.removeItem(key);
      return null;
    }

    memoryFullCache.set(normalizedSlug, { payload: parsed.payload, expiresAt });
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeCategoryArtistsFullPayloadToCache(slug?: string | null, payload?: CategoryArtistsFullPayload) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug || !payload) {
    return;
  }

  const expiresAt = payload.fetchedAt + CATEGORY_ARTISTS_FULL_TTL_MS;
  memoryFullCache.set(normalizedSlug, { payload, expiresAt });

  if (typeof window !== "undefined") {
    const key = getFullPayloadKey(normalizedSlug);
    if (key) {
      try {
        window.localStorage.setItem(key, JSON.stringify({ payload, expiresAt }));
      } catch {
        // Best effort only.
      }
    }
  }

  emitCategoryArtistsCacheEvent(normalizedSlug);
}

function shouldProbeServerForFullCache(cached: CategoryArtistsFullPayload) {
  return Date.now() - cached.lastCheckedAt >= CATEGORY_ARTISTS_FULL_REVALIDATE_MS;
}

async function probeCategoryArtistsFreshness(slug: string) {
  const payload = await fetchCategoryArtistsPage(slug, 0, 1);
  if (!payload) {
    return null;
  }

  return {
    totalArtists: payload.totalArtists,
    firstSlug: payload.artists[0]?.slug ?? null,
  };
}

export async function prefetchCategoryArtistsFirstPayload(slug?: string | null): Promise<CategoryArtistsFirstPayload | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const cached = readCategoryArtistsFirstPayloadFromSessionCache(normalizedSlug);
  if (cached?.tabCounts) {
    return cached;
  }

  if (typeof window === "undefined") {
    return null;
  }

  const inFlight = inFlightBySlug.get(normalizedSlug);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = fetchCategoryArtistsPageWithRetry(normalizedSlug, 0, FIRST_PAGE_LIMIT, true)
    .then((payload) => {
      if (!payload) {
        return cached ?? null;
      }

      writeCategoryArtistsFirstPayloadToSessionCache(normalizedSlug, payload);
      return payload;
    })
    .finally(() => {
      inFlightBySlug.delete(normalizedSlug);
    });

  inFlightBySlug.set(normalizedSlug, requestPromise);
  return requestPromise;
}

export async function prefetchCategoryArtistsFirstPayloadForSlugs(slugs: string[]) {
  const uniqueSlugs = [...new Set(slugs.map((slug) => normalizeSlug(slug)).filter((slug): slug is string => Boolean(slug)))];
  if (uniqueSlugs.length === 0) {
    return;
  }

  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= uniqueSlugs.length) {
        return;
      }

      const currentSlug = uniqueSlugs[currentIndex];
      if (!currentSlug) {
        continue;
      }

      await prefetchCategoryArtistsFirstPayload(currentSlug);
    }
  }

  const workerCount = Math.max(1, Math.min(FIRST_PAYLOAD_PREFETCH_CONCURRENCY, uniqueSlugs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

type PrimeCategoryArtistsFullPayloadOptions = {
  seedPayload?: CategoryArtistsFirstPayload | null;
  force?: boolean;
  onPage?: (artists: CategoryArtistCard[], offset: number) => void;
};

export async function primeCategoryArtistsFullPayload(
  slug?: string | null,
  options: PrimeCategoryArtistsFullPayloadOptions = {},
): Promise<CategoryArtistsFullPayload | null> {
  const maybeSlug = normalizeSlug(slug);
  if (!maybeSlug) {
    return null;
  }
  const normalizedSlug = maybeSlug;

  const inFlight = inFlightFullBySlug.get(normalizedSlug);
  if (inFlight && !options.force) {
    return inFlight;
  }

  const task = (async () => {
    const cachedFull = readCategoryArtistsFullPayloadFromCache(normalizedSlug);

    if (cachedFull && !options.force) {
      if (!isCompleteCategoryArtistsPayload(cachedFull)) {
        memoryFullCache.delete(normalizedSlug);
        if (typeof window !== "undefined") {
          const cacheKey = getFullPayloadKey(normalizedSlug);
          if (cacheKey) {
            window.localStorage.removeItem(cacheKey);
          }
        }
      } else {
        if (!shouldProbeServerForFullCache(cachedFull)) {
          return cachedFull;
        }

        const freshness = await probeCategoryArtistsFreshness(normalizedSlug);
        if (freshness) {
          const cachedFirstSlug = cachedFull.artists[0]?.slug ?? null;
          if (freshness.totalArtists === cachedFull.totalArtists && freshness.firstSlug === cachedFirstSlug) {
            const refreshedCache: CategoryArtistsFullPayload = {
              ...cachedFull,
              lastCheckedAt: Date.now(),
            };
            writeCategoryArtistsFullPayloadToCache(normalizedSlug, refreshedCache);
            return refreshedCache;
          }
        }
      }
    }

    const baseline = options.seedPayload && options.seedPayload.artists.length > 0
      ? options.seedPayload
      : await prefetchCategoryArtistsFirstPayload(normalizedSlug);

    if (!baseline) {
      return cachedFull && isCompleteCategoryArtistsPayload(cachedFull) ? cachedFull : null;
    }

    writeCategoryArtistsFirstPayloadToSessionCache(normalizedSlug, baseline);

    const hasKnownTotal = typeof baseline.totalArtists === "number" && Number.isFinite(baseline.totalArtists);
    const knownTotalArtists = hasKnownTotal ? Number(baseline.totalArtists) : null;
    const totalArtists = knownTotalArtists !== null
      ? Math.max(0, knownTotalArtists)
      : baseline.artists.length;

    if (hasKnownTotal && (baseline.artists.length >= totalArtists || totalArtists === 0)) {
      const completePayload: CategoryArtistsFullPayload = {
        ...baseline,
        hasMore: false,
        nextOffset: baseline.artists.length,
        fetchedAt: Date.now(),
        lastCheckedAt: Date.now(),
      };
      writeCategoryArtistsFullPayloadToCache(normalizedSlug, completePayload);
      return completePayload;
    }
    let fullArtists = baseline.artists;

    if (hasKnownTotal) {
      const offsets: number[] = [];
      for (let offset = baseline.nextOffset; offset < totalArtists; offset += FULL_PAGE_LIMIT) {
        offsets.push(offset);
      }

      const pagesByOffset = new Map<number, CategoryArtistCard[]>();
      const failedOffsets: number[] = [];
      let nextOffsetIndex = 0;

      async function worker() {
        while (true) {
          const index = nextOffsetIndex;
          nextOffsetIndex += 1;

          if (index >= offsets.length) {
            return;
          }

          const offset = offsets[index] ?? 0;
          const page = await fetchCategoryArtistsPageWithRetry(normalizedSlug, offset, FULL_PAGE_LIMIT);
          if (!page) {
            failedOffsets.push(offset);
            continue;
          }

          pagesByOffset.set(offset, page.artists);
          options.onPage?.(page.artists, offset);
        }
      }

      const workerCount = Math.max(1, Math.min(FULL_FETCH_CONCURRENCY, offsets.length));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (failedOffsets.length > 0) {
        const uniqueFailedOffsets = [...new Set(failedOffsets)].sort((a, b) => a - b);
        for (const offset of uniqueFailedOffsets) {
          const retryPage = await fetchCategoryArtistsPageWithRetry(normalizedSlug, offset, FULL_PAGE_LIMIT);
          if (!retryPage) {
            continue;
          }

          pagesByOffset.set(offset, retryPage.artists);
          options.onPage?.(retryPage.artists, offset);
        }
      }

      const sortedOffsets = [...pagesByOffset.keys()].sort((a, b) => a - b);
      for (const offset of sortedOffsets) {
        const pageArtists = pagesByOffset.get(offset) ?? [];
        fullArtists = mergeArtists(fullArtists, pageArtists);
      }
    } else {
      let nextOffset = baseline.nextOffset;
      let hasMore = baseline.hasMore;
      let pageGuard = 0;

      while (hasMore && pageGuard < 80) {
        const page = await fetchCategoryArtistsPageWithRetry(normalizedSlug, nextOffset, FULL_PAGE_LIMIT);
        if (!page) {
          break;
        }

        fullArtists = mergeArtists(fullArtists, page.artists);
        options.onPage?.(page.artists, nextOffset);

        hasMore = page.hasMore;
        const resolvedNextOffset = Number.isFinite(page.nextOffset)
          ? page.nextOffset
          : nextOffset + page.artists.length;

        if (resolvedNextOffset <= nextOffset) {
          break;
        }

        nextOffset = resolvedNextOffset;
        pageGuard += 1;
      }
    }

    const finalizedTotalArtists = hasKnownTotal ? totalArtists : fullArtists.length;

    const fullPayloadComplete = hasKnownTotal ? fullArtists.length >= totalArtists : true;

    const finalizedPayload: CategoryArtistsFullPayload = {
      artists: fullArtists,
      totalArtists: finalizedTotalArtists,
      tabCounts: baseline.tabCounts,
      hasMore: !fullPayloadComplete,
      nextOffset: fullArtists.length,
      fetchedAt: Date.now(),
      lastCheckedAt: Date.now(),
    };

    if (fullPayloadComplete) {
      writeCategoryArtistsFullPayloadToCache(normalizedSlug, finalizedPayload);
    }
    writeCategoryArtistsFirstPayloadToSessionCache(normalizedSlug, {
      artists: finalizedPayload.artists.slice(0, FIRST_PAGE_LIMIT),
      totalArtists: finalizedPayload.totalArtists,
      tabCounts: finalizedPayload.tabCounts,
      hasMore: finalizedPayload.artists.length > FIRST_PAGE_LIMIT,
      nextOffset: Math.min(finalizedPayload.artists.length, FIRST_PAGE_LIMIT),
    });

    return finalizedPayload;
  })().finally(() => {
    inFlightFullBySlug.delete(normalizedSlug);
  });

  inFlightFullBySlug.set(normalizedSlug, task);
  return task;
}

function normalizeArtistNameKey(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function patchArtistThumbnailInList(
  artists: CategoryArtistCard[],
  artistName: string,
  thumbnailVideoId: string,
) {
  const artistKey = normalizeArtistNameKey(artistName);
  if (!artistKey) {
    return { artists, changed: false };
  }

  let changed = false;
  const nextArtists = artists.map((artist) => {
    if (normalizeArtistNameKey(artist.name) !== artistKey) {
      return artist;
    }

    if (artist.thumbnailVideoId === thumbnailVideoId) {
      return artist;
    }

    changed = true;
    return {
      ...artist,
      thumbnailVideoId,
    };
  });

  return { artists: nextArtists, changed };
}

export function patchCategoryArtistThumbnailInCaches(
  slug: string,
  artistName: string,
  thumbnailVideoId: string,
) {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedVideoId = thumbnailVideoId.trim();
  if (!normalizedSlug || !artistName.trim() || !normalizedVideoId) {
    return false;
  }

  let changed = false;

  const firstPayload = readCategoryArtistsFirstPayloadFromSessionCache(normalizedSlug);
  if (firstPayload) {
    const patchedFirst = patchArtistThumbnailInList(firstPayload.artists, artistName, normalizedVideoId);
    if (patchedFirst.changed) {
      changed = true;
      writeCategoryArtistsFirstPayloadToSessionCache(normalizedSlug, {
        ...firstPayload,
        artists: patchedFirst.artists,
      });
    }
  }

  const fullPayload = readCategoryArtistsFullPayloadFromCache(normalizedSlug);
  if (fullPayload) {
    const patchedFull = patchArtistThumbnailInList(fullPayload.artists, artistName, normalizedVideoId);
    if (patchedFull.changed) {
      changed = true;
      writeCategoryArtistsFullPayloadToCache(normalizedSlug, {
        ...fullPayload,
        artists: patchedFull.artists,
      });
    }
  }

  return changed;
}

export { CATEGORY_ARTISTS_CACHE_EVENT };
