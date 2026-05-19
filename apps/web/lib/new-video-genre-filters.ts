export const NEW_VIDEO_GENRE_FILTER_LIMIT = 24;

export function normalizeNewVideoGenreFilters(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized = input
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value.length > 0)
    .slice(0, NEW_VIDEO_GENRE_FILTER_LIMIT);

  return [...new Set(normalized)];
}

export function parseNewVideoGenreFilterParam(value: string | null | undefined): string[] {
  if (!value || typeof value !== "string") {
    return [];
  }

  const raw = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalizeNewVideoGenreFilters(raw);
}

export function doesVideoMatchNewGenreFilters(videoGenre: string | null | undefined, allowedGenres: string[]): boolean {
  if (allowedGenres.length === 0) {
    return true;
  }

  const normalizedGenre = (videoGenre ?? "").trim().toLowerCase();
  if (!normalizedGenre) {
    return false;
  }

  return allowedGenres.some((genre) => normalizedGenre.includes(genre));
}
