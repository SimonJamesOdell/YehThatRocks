"use client";

import type { CategoryArtistCard } from "@/lib/catalog-data";

const CATEGORY_ARTISTS_SESSION_KEY_PREFIX = "ytr:categories:artists:first:v1:";
const CATEGORY_ARTISTS_FULL_KEY_PREFIX = "ytr:categories:artists:full:v1:";
const CATEGORY_ARTISTS_CACHE_EVENT = "ytr:category-artists-cache-updated";
const CATEGORY_ARTISTS_SESSION_TTL_MS = 30 * 60 * 1000;
const CATEGORY_ARTISTS_FULL_TTL_MS = 24 * 60 * 60 * 1000;
const CATEGORY_ARTISTS_FULL_REVALIDATE_MS = 20 * 60 * 1000;
const FIRST_PAGE_LIMIT = 50;
const FULL_PAGE_LIMIT = 192;
const FULL_FETCH_CONCURRENCY = 4;

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

async function fetchCategoryArtistsPage(slug: string, offset: number, limit: number) {
  const response = await fetch(`/api/categories/${encodeURIComponent(slug)}/artists?limit=${limit}&offset=${offset}`, {
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
  if (cached) {
    return cached;
  }

  if (typeof window === "undefined") {
    return null;
  }

  const inFlight = inFlightBySlug.get(normalizedSlug);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = fetchCategoryArtistsPage(normalizedSlug, 0, FIRST_PAGE_LIMIT)
    .then((payload) => {
      if (!payload) {
        return null;
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
  await Promise.all(uniqueSlugs.map((slug) => prefetchCategoryArtistsFirstPayload(slug)));
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
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const inFlight = inFlightFullBySlug.get(normalizedSlug);
  if (inFlight && !options.force) {
    return inFlight;
  }

  const task = (async () => {
    const cachedFull = readCategoryArtistsFullPayloadFromCache(normalizedSlug);

    if (cachedFull && !options.force) {
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

    const baseline = options.seedPayload && options.seedPayload.artists.length > 0
      ? options.seedPayload
      : await prefetchCategoryArtistsFirstPayload(normalizedSlug);

    if (!baseline) {
      return cachedFull ?? null;
    }

    writeCategoryArtistsFirstPayloadToSessionCache(normalizedSlug, baseline);

    const totalArtists = typeof baseline.totalArtists === "number" && Number.isFinite(baseline.totalArtists)
      ? Math.max(0, baseline.totalArtists)
      : baseline.artists.length;

    if (baseline.artists.length >= totalArtists || totalArtists === 0) {
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

    const offsets: number[] = [];
    for (let offset = baseline.nextOffset; offset < totalArtists; offset += FULL_PAGE_LIMIT) {
      offsets.push(offset);
    }

    const pagesByOffset = new Map<number, CategoryArtistCard[]>();
    let nextOffsetIndex = 0;

    async function worker() {
      while (true) {
        const index = nextOffsetIndex;
        nextOffsetIndex += 1;

        if (index >= offsets.length) {
          return;
        }

        const offset = offsets[index] ?? 0;
        const page = await fetchCategoryArtistsPage(normalizedSlug, offset, FULL_PAGE_LIMIT);
        if (!page) {
          continue;
        }

        pagesByOffset.set(offset, page.artists);
        options.onPage?.(page.artists, offset);
      }
    }

    const workerCount = Math.max(1, Math.min(FULL_FETCH_CONCURRENCY, offsets.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    let fullArtists = baseline.artists;
    const sortedOffsets = [...pagesByOffset.keys()].sort((a, b) => a - b);
    for (const offset of sortedOffsets) {
      const pageArtists = pagesByOffset.get(offset) ?? [];
      fullArtists = mergeArtists(fullArtists, pageArtists);
    }

    const finalizedPayload: CategoryArtistsFullPayload = {
      artists: fullArtists,
      totalArtists: totalArtists,
      tabCounts: baseline.tabCounts,
      hasMore: false,
      nextOffset: fullArtists.length,
      fetchedAt: Date.now(),
      lastCheckedAt: Date.now(),
    };

    writeCategoryArtistsFullPayloadToCache(normalizedSlug, finalizedPayload);
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

export { CATEGORY_ARTISTS_CACHE_EVENT };
