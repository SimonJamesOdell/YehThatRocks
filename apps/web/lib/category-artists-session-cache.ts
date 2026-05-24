"use client";

import type { CategoryArtistCard } from "@/lib/catalog-data";

const CATEGORY_ARTISTS_SESSION_KEY_PREFIX = "ytr:categories:artists:first:v1:";
const CATEGORY_ARTISTS_SESSION_TTL_MS = 30 * 60 * 1000;
const FIRST_PAGE_LIMIT = 30;

type CategoryArtistsFirstPayload = {
  artists: CategoryArtistCard[];
  totalArtists: number | null;
  tabCounts: Record<string, number> | null;
  hasMore: boolean;
  nextOffset: number;
};

const memoryCache = new Map<string, { payload: CategoryArtistsFirstPayload; expiresAt: number }>();
const inFlightBySlug = new Map<string, Promise<CategoryArtistsFirstPayload | null>>();

function isCategoryArtistsPayload(value: unknown): value is CategoryArtistsFirstPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<CategoryArtistsFirstPayload>;
  return Array.isArray(payload.artists)
    && typeof payload.hasMore === "boolean"
    && Number.isFinite(Number(payload.nextOffset));
}

function getSessionStorageKey(slug: string) {
  return `${CATEGORY_ARTISTS_SESSION_KEY_PREFIX}${slug.trim().toLowerCase()}`;
}

export function readCategoryArtistsFirstPayloadFromSessionCache(slug: string): CategoryArtistsFirstPayload | null {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  const now = Date.now();
  const memoryEntry = memoryCache.get(normalizedSlug);
  if (memoryEntry && memoryEntry.expiresAt > now) {
    return memoryEntry.payload;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(getSessionStorageKey(normalizedSlug));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { payload?: unknown; expiresAt?: unknown };
    const expiresAt = Number(parsed?.expiresAt ?? 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      window.sessionStorage.removeItem(getSessionStorageKey(normalizedSlug));
      return null;
    }

    if (!isCategoryArtistsPayload(parsed?.payload)) {
      window.sessionStorage.removeItem(getSessionStorageKey(normalizedSlug));
      return null;
    }

    memoryCache.set(normalizedSlug, { payload: parsed.payload, expiresAt });
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeCategoryArtistsFirstPayloadToSessionCache(slug: string, payload: CategoryArtistsFirstPayload) {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return;
  }

  const expiresAt = Date.now() + CATEGORY_ARTISTS_SESSION_TTL_MS;
  memoryCache.set(normalizedSlug, { payload, expiresAt });

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(getSessionStorageKey(normalizedSlug), JSON.stringify({ payload, expiresAt }));
  } catch {
    // Best effort only.
  }
}

export async function prefetchCategoryArtistsFirstPayload(slug: string): Promise<CategoryArtistsFirstPayload | null> {
  const normalizedSlug = slug.trim().toLowerCase();
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

  const requestPromise = fetch(`/api/categories/${encodeURIComponent(normalizedSlug)}/artists?limit=${FIRST_PAGE_LIMIT}&offset=0`, {
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        artists?: CategoryArtistCard[];
        totalArtists?: number | null;
        tabCounts?: Record<string, number> | null;
        hasMore?: boolean;
        nextOffset?: number;
      };

      const normalizedPayload: CategoryArtistsFirstPayload = {
        artists: Array.isArray(payload.artists) ? payload.artists : [],
        totalArtists: typeof payload.totalArtists === "number" && Number.isFinite(payload.totalArtists)
          ? payload.totalArtists
          : null,
        tabCounts: payload.tabCounts && typeof payload.tabCounts === "object" ? payload.tabCounts : null,
        hasMore: payload.hasMore === true,
        nextOffset: Number.isFinite(Number(payload.nextOffset)) ? Number(payload.nextOffset) : 0,
      };

      writeCategoryArtistsFirstPayloadToSessionCache(normalizedSlug, normalizedPayload);
      return normalizedPayload;
    })
    .catch(() => null)
    .finally(() => {
      inFlightBySlug.delete(normalizedSlug);
    });

  inFlightBySlug.set(normalizedSlug, requestPromise);
  return requestPromise;
}

export async function prefetchCategoryArtistsFirstPayloadForSlugs(slugs: string[]) {
  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))];
  for (const slug of uniqueSlugs) {
    await prefetchCategoryArtistsFirstPayload(slug);
  }
}
