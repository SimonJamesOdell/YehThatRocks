"use client";

export const CATEGORY_ARTISTS_TAB_EVENT = "ytr:category-artists-tab-updated";

const CATEGORY_ARTISTS_TAB_KEY_PREFIX = "ytr:categories:artists:tab:v1:";

function normalizeSlug(slug?: string | null) {
  const normalizedSlug = slug?.trim().toLowerCase();
  return normalizedSlug || null;
}

function getTabKey(slug?: string | null) {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  return `${CATEGORY_ARTISTS_TAB_KEY_PREFIX}${normalizedSlug}`;
}

export function readCategoryArtistsTab(slug?: string | null) {
  if (typeof window === "undefined") {
    return "all";
  }

  const key = getTabKey(slug);
  if (!key) {
    return "all";
  }

  try {
    const value = window.sessionStorage.getItem(key)?.trim();
    return value || "all";
  } catch {
    return "all";
  }
}

export function writeCategoryArtistsTab(slug: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  const key = getTabKey(slug);
  if (!key) {
    return;
  }

  const normalizedValue = value.trim().toLowerCase() || "all";
  const normalizedSlug = slug.trim().toLowerCase();

  try {
    if (normalizedValue === "all") {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, normalizedValue);
    }
  } catch {
    // Best effort only.
  }

  window.dispatchEvent(new CustomEvent(CATEGORY_ARTISTS_TAB_EVENT, {
    detail: {
      slug: normalizedSlug,
      value: normalizedValue,
    },
  }));
}
