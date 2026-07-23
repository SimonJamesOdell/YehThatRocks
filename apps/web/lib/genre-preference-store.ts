/**
 * genre-preference-store.ts
 * Shared localStorage read/write for genre preferences set via the welcome modal.
 *
 * The welcome modal stores a JSON array of top-level genre bucket labels
 * under the key `ytr:genre-preferences`. Consumers (new-videos page filter,
 * autoplay/watch-next rail) read from this store as a fallback when no
 * user-account preference has been explicitly configured.
 *
 * An empty or missing store means "all genres" — no filtering.
 */

const GENRE_PREFERENCES_KEY = "ytr:genre-preferences";

/** Read the persisted genre preference labels. Returns null when no preference
 *  has been stored (meaning "all genres"). */
export function readGenrePreferences(): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(GENRE_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const normalized = parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());

    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

/** Write genre preference labels to localStorage. Pass an empty array to clear. */
export function writeGenrePreferences(genres: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(GENRE_PREFERENCES_KEY, JSON.stringify(genres));
  } catch {
    // Best-effort only.
  }
}

/** Clear the genre preference store (revert to "all genres"). */
export function clearGenrePreferences(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(GENRE_PREFERENCES_KEY);
  } catch {
    // Best-effort only.
  }
}

/**
 * Check whether the user has explicitly set genre preferences via the
 * welcome modal. Returns true only when a non-empty preference array exists.
 */
export function hasGenrePreferences(): boolean {
  const prefs = readGenrePreferences();
  return prefs !== null && prefs.length > 0;
}
