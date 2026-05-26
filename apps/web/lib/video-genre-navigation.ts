import { getGenreSlug } from "@/lib/catalog-data-utils";
import { resolveTopLevelGenreBucket, TOP_LEVEL_GENRE_BUCKET_LABELS } from "@/lib/genre-buckets";
import { buildCategoryArtistTabs } from "@/lib/category-artists-tabs";

export type VideoGenreNavigationTarget = {
  label: string;
  categoryLabel: string;
  categorySlug: string;
  tabId: string;
  href: string;
};

const FALLBACK_GENRE_LABEL = "Rock / Metal";
const FALLBACK_CATEGORY_LABEL = "Rock & Alternative";

function normalizeGenreLabel(input: string | null | undefined) {
  const value = input?.trim();
  return value && value.length > 0 ? value : FALLBACK_GENRE_LABEL;
}

function resolveCategoryLabel(genreLabel: string) {
  const directTopLevelMatch = TOP_LEVEL_GENRE_BUCKET_LABELS.find((label) => label.toLowerCase() === genreLabel.toLowerCase());
  if (directTopLevelMatch) {
    return directTopLevelMatch;
  }

  return resolveTopLevelGenreBucket(genreLabel) ?? FALLBACK_CATEGORY_LABEL;
}

function resolveTabIdForGenre(categoryLabel: string, genreLabel: string) {
  const tabs = buildCategoryArtistTabs(categoryLabel);
  const explicitMatch = tabs.find((tab) => tab.id !== "all" && tab.matches(genreLabel));
  return explicitMatch?.id ?? "all";
}

export function resolveVideoGenreNavigationTarget(inputGenre: string | null | undefined): VideoGenreNavigationTarget {
  const label = normalizeGenreLabel(inputGenre);
  const categoryLabel = resolveCategoryLabel(label);
  const categorySlug = getGenreSlug(categoryLabel);
  const tabId = resolveTabIdForGenre(categoryLabel, label);
  const href = tabId === "all"
    ? `/categories/${categorySlug}`
    : `/categories/${categorySlug}?tab=${encodeURIComponent(tabId)}`;

  return {
    label,
    categoryLabel,
    categorySlug,
    tabId,
    href,
  };
}
