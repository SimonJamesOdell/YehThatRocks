"use client";

import type { GenreCard } from "@/lib/catalog-data";

const CATEGORY_CARDS_SESSION_KEY = "ytr:categories:top-level-cards:v1";
const CATEGORY_CARDS_SESSION_TTL_MS = 30 * 60 * 1000;

let memoryCache: { cards: GenreCard[]; expiresAt: number } | null = null;
let inFlightPrefetch: Promise<GenreCard[] | null> | null = null;

function isValidCards(value: unknown): value is GenreCard[] {
  return Array.isArray(value) && value.every((entry) => {
    return entry && typeof entry === "object"
      && typeof (entry as GenreCard).genre === "string"
      && typeof (entry as GenreCard).artistCount === "number";
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

    memoryCache = { cards: parsed.cards, expiresAt };
    return parsed.cards;
  } catch {
    return null;
  }
}

export function writeCategoryCardsSessionCache(cards: GenreCard[]) {
  const expiresAt = Date.now() + CATEGORY_CARDS_SESSION_TTL_MS;
  memoryCache = { cards, expiresAt };

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(CATEGORY_CARDS_SESSION_KEY, JSON.stringify({ cards, expiresAt }));
  } catch {
    // Best effort only.
  }
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
