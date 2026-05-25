"use client";

import type { GenreCard } from "@/lib/catalog-data";

const CATEGORY_CARDS_SESSION_KEY = "ytr:categories:top-level-cards:v1";
const CATEGORY_CARDS_PIN_OVERRIDES_KEY = "ytr:categories:top-level-card-pin-overrides:v1";
const CATEGORY_CARDS_SESSION_TTL_MS = 30 * 60 * 1000;

let memoryCache: { cards: GenreCard[]; expiresAt: number } | null = null;
let inFlightPrefetch: Promise<GenreCard[] | null> | null = null;
let memoryPinOverrides: Map<string, string> | null = null;

function isValidCards(value: unknown): value is GenreCard[] {
  return Array.isArray(value) && value.every((entry) => {
    return entry && typeof entry === "object"
      && typeof (entry as GenreCard).genre === "string"
      && typeof (entry as GenreCard).artistCount === "number";
  });
}

function readPinOverridesMap() {
  if (memoryPinOverrides) {
    return memoryPinOverrides;
  }

  const nextMap = new Map<string, string>();

  if (typeof window === "undefined") {
    memoryPinOverrides = nextMap;
    return nextMap;
  }

  try {
    const raw = window.sessionStorage.getItem(CATEGORY_CARDS_PIN_OVERRIDES_KEY);
    if (!raw) {
      memoryPinOverrides = nextMap;
      return nextMap;
    }

    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedGenre = key.trim().toLowerCase();
      const normalizedVideoId = typeof value === "string" ? value.trim() : "";
      if (!normalizedGenre || !normalizedVideoId) {
        continue;
      }

      nextMap.set(normalizedGenre, normalizedVideoId);
    }
  } catch {
    // Best effort only.
  }

  memoryPinOverrides = nextMap;
  return nextMap;
}

function persistPinOverridesMap(map: Map<string, string>) {
  memoryPinOverrides = map;

  if (typeof window === "undefined") {
    return;
  }

  try {
    const serialized = Object.fromEntries(map.entries());
    window.sessionStorage.setItem(CATEGORY_CARDS_PIN_OVERRIDES_KEY, JSON.stringify(serialized));
  } catch {
    // Best effort only.
  }
}

export function applyCategoryCardThumbnailPinOverrides(cards: GenreCard[]) {
  if (cards.length === 0) {
    return cards;
  }

  const overrides = readPinOverridesMap();
  if (overrides.size === 0) {
    return cards;
  }

  return cards.map((card) => {
    const pinnedVideoId = overrides.get(card.genre.trim().toLowerCase());
    if (!pinnedVideoId || pinnedVideoId === card.previewVideoId) {
      return card;
    }

    return {
      ...card,
      previewVideoId: pinnedVideoId,
    };
  });
}

export function readCategoryCardsSessionCache(): GenreCard[] | null {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return memoryCache.cards;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(CATEGORY_CARDS_SESSION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { cards?: unknown; expiresAt?: unknown };
    const expiresAt = Number(parsed?.expiresAt ?? 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      window.sessionStorage.removeItem(CATEGORY_CARDS_SESSION_KEY);
      return null;
    }

    if (!isValidCards(parsed?.cards)) {
      window.sessionStorage.removeItem(CATEGORY_CARDS_SESSION_KEY);
      return null;
    }

    const cards = applyCategoryCardThumbnailPinOverrides(parsed.cards);
    memoryCache = { cards, expiresAt };
    return cards;
  } catch {
    return null;
  }
}

export function writeCategoryCardsSessionCache(cards: GenreCard[]) {
  const cardsWithOverrides = applyCategoryCardThumbnailPinOverrides(cards);
  const expiresAt = Date.now() + CATEGORY_CARDS_SESSION_TTL_MS;
  memoryCache = { cards: cardsWithOverrides, expiresAt };

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(CATEGORY_CARDS_SESSION_KEY, JSON.stringify({ cards: cardsWithOverrides, expiresAt }));
  } catch {
    // Best effort only.
  }
}

export function writeCategoryCardThumbnailPinOverride(genre: string, thumbnailVideoId: string) {
  const normalizedGenre = genre.trim().toLowerCase();
  const normalizedVideoId = thumbnailVideoId.trim();
  if (!normalizedGenre || !normalizedVideoId) {
    return;
  }

  const overrides = readPinOverridesMap();
  overrides.set(normalizedGenre, normalizedVideoId);
  persistPinOverridesMap(overrides);
}

export async function prefetchCategoryCardsSessionCache(): Promise<GenreCard[] | null> {
  const cached = readCategoryCardsSessionCache();
  if (cached && cached.length > 0) {
    return cached;
  }

  if (typeof window === "undefined") {
    return null;
  }

  if (inFlightPrefetch) {
    return inFlightPrefetch;
  }

  inFlightPrefetch = fetch("/api/categories/top-level-cards", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { cards?: unknown };
      if (!isValidCards(payload?.cards)) {
        return null;
      }

      writeCategoryCardsSessionCache(payload.cards);
      return payload.cards;
    })
    .catch(() => null)
    .finally(() => {
      inFlightPrefetch = null;
    });

  return inFlightPrefetch;
}

export function patchCategoryCardThumbnailInSessionCache(genre: string, thumbnailVideoId: string): GenreCard[] | null {
  const normalizedGenre = genre.trim().toLowerCase();
  const normalizedVideoId = thumbnailVideoId.trim();
  if (!normalizedGenre || !normalizedVideoId) {
    return null;
  }

  writeCategoryCardThumbnailPinOverride(genre, thumbnailVideoId);

  const cached = readCategoryCardsSessionCache();
  if (!cached || cached.length === 0) {
    return null;
  }

  let changed = false;
  const nextCards = cached.map((card) => {
    if (card.genre.trim().toLowerCase() !== normalizedGenre) {
      return card;
    }

    if (card.previewVideoId === normalizedVideoId) {
      return card;
    }

    changed = true;
    return {
      ...card,
      previewVideoId: normalizedVideoId,
    };
  });

  if (changed) {
    writeCategoryCardsSessionCache(nextCards);
  }

  return nextCards;
}
