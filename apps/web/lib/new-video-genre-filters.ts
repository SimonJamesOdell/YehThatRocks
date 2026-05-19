export const NEW_VIDEO_GENRE_FILTER_LIMIT = 128;

export type NewVideoGenreFilterState = {
  includeGenres: string[];
  excludeGenres: string[];
};

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

export function normalizeNewVideoGenreFilterState(input: unknown): NewVideoGenreFilterState {
  if (Array.isArray(input)) {
    return {
      includeGenres: normalizeNewVideoGenreFilters(input),
      excludeGenres: [],
    };
  }

  if (!input || typeof input !== "object") {
    return {
      includeGenres: [],
      excludeGenres: [],
    };
  }

  const record = input as {
    includeGenres?: unknown;
    excludeGenres?: unknown;
    genres?: unknown;
  };

  const includeGenres = normalizeNewVideoGenreFilters(record.includeGenres ?? record.genres ?? []);
  const includeSet = new Set(includeGenres);
  const excludeGenres = normalizeNewVideoGenreFilters(record.excludeGenres ?? [])
    .filter((genre) => !includeSet.has(genre));

  return {
    includeGenres,
    excludeGenres,
  };
}

export function parseNewVideoGenreFilterStateFromParams(input: {
  includeParam?: string | null;
  excludeParam?: string | null;
  legacyParam?: string | null;
}): NewVideoGenreFilterState {
  const includeGenres = parseNewVideoGenreFilterParam(input.includeParam ?? input.legacyParam ?? null);
  const includeSet = new Set(includeGenres);
  const excludeGenres = parseNewVideoGenreFilterParam(input.excludeParam ?? null)
    .filter((genre) => !includeSet.has(genre));

  return {
    includeGenres,
    excludeGenres,
  };
}

export function doesVideoMatchNewGenreFilters(
  videoGenre: string | null | undefined,
  includeGenres: string[],
  excludeGenres: string[] = [],
): boolean {
  if (includeGenres.length === 0 && excludeGenres.length === 0) {
    return true;
  }

  const normalizedGenre = (videoGenre ?? "").trim().toLowerCase();
  if (!normalizedGenre) {
    return includeGenres.length === 0;
  }

  if (excludeGenres.some((genre) => normalizedGenre.includes(genre))) {
    return false;
  }

  if (includeGenres.length === 0) {
    return true;
  }

  return includeGenres.some((genre) => normalizedGenre.includes(genre));
}
