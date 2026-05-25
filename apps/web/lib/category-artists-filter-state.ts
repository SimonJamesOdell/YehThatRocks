"use client";

export const CATEGORY_ARTISTS_FILTER_EVENT = "ytr:category-artists-filter-updated";

const CATEGORY_ARTISTS_FILTER_KEY_PREFIX = "ytr:categories:artists:filter:v1:";

function normalizeSlug(slug?: string | null) {
  const normalizedSlug = slug?.trim().toLowerCase();
  return normalizedSlug || null;
}

function getFilterKey(slug?: string | null) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  return `${CATEGORY_ARTISTS_FILTER_KEY_PREFIX}${normalizedSlug}`;
}

export function readCategoryArtistsFilter(slug?: string | null) {
  if (typeof window === "undefined") {
    return "";
  }

  const key = getFilterKey(slug);
  if (!key) {
    return "";
  }

  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeCategoryArtistsFilter(slug: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  const key = getFilterKey(slug);
  if (!key) {
    return;
  }

  const normalized = value.trimStart();

  try {
    if (normalized.length === 0) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, normalized);
    }
  } catch {
    // Best effort only.
  }

  window.dispatchEvent(new CustomEvent(CATEGORY_ARTISTS_FILTER_EVENT, {
    detail: {
      slug: slug.trim().toLowerCase(),
      value: normalized,
    },
  }));
}
