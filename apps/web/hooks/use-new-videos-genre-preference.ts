"use client";

import { useEffect, useState } from "react";

import { parseJsonOrNull } from "@/lib/parse-json";
import { readGenrePreferences } from "@/lib/genre-preference-store";
import {
  normalizeNewVideoGenreFilterState,
  normalizeNewVideoGenreFilters,
  type NewVideoGenreFilterState,
} from "@/lib/new-video-genre-filters";

const LOCAL_STORAGE_KEY = "ytr:new-videos-genre-filters";

function readPersistedFilters() {
  if (typeof window === "undefined") {
    return {
      includeGenres: [],
      excludeGenres: [],
    } satisfies NewVideoGenreFilterState;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = normalizeNewVideoGenreFilterState(JSON.parse(raw));
      // If the persisted value is empty (e.g. written by a previous buggy
      // visit), treat it as unset so we fall through to the welcome-modal
      // genre-preference fallback.
      if (parsed.includeGenres.length > 0 || parsed.excludeGenres.length > 0) {
        return parsed;
      }
    }

    // Normalize through the same pipeline so casing matches the facet comparison.
    const welcomeGenres = readGenrePreferences();
    if (welcomeGenres && welcomeGenres.length > 0) {
      return {
        includeGenres: normalizeNewVideoGenreFilters(welcomeGenres),
        excludeGenres: [],
      } satisfies NewVideoGenreFilterState;
    }

    return {
      includeGenres: [],
      excludeGenres: [],
    } satisfies NewVideoGenreFilterState;
  } catch {
    return {
      includeGenres: [],
      excludeGenres: [],
    } satisfies NewVideoGenreFilterState;
  }
}

function writePersistedFilters(filters: NewVideoGenreFilterState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    // Remove the key when filters are empty so the welcome-genre fallback
    // in readPersistedFilters can take effect on the next visit.
    if (filters.includeGenres.length === 0 && filters.excludeGenres.length === 0) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Best-effort persistence only.
  }
}

export function useNewVideosGenrePreference(isAuthenticated: boolean) {
  const [filters, setFilters] = useState<NewVideoGenreFilterState>(() => {
    // For unauthenticated users, read persisted filters immediately so the
    // first render already carries the correct genre selection.  Without
    // this the "new" page data-loader fires with empty filters before the
    // useEffect below has a chance to hydrate, producing the wrong videos
    // and stale-generation duplicate-key errors.
    if (!isAuthenticated) {
      return readPersistedFilters();
    }
    return { includeGenres: [], excludeGenres: [] };
  });
  const [isServerHydrated, setIsServerHydrated] = useState(() => !isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      // Filters were already initialised from localStorage via the lazy
      // useState initializer above — nothing more to load.
      setIsServerHydrated(true);
      return;
    }

    let cancelled = false;
    const local = readPersistedFilters();
    setFilters(local);
    setIsServerHydrated(false);

    const loadServerValue = async () => {
      try {
        const response = await fetch("/api/new-videos-preferences", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await parseJsonOrNull(response)) as {
          includeGenres?: string[];
          excludeGenres?: string[];
          genres?: string[];
        } | null;
        if (cancelled) {
          return;
        }

        const next = normalizeNewVideoGenreFilterState({
          includeGenres: payload?.includeGenres,
          excludeGenres: payload?.excludeGenres,
          genres: payload?.genres,
        });

        // If the server has no preferences yet (new account), keep the
        // local fallback from the welcome modal or previous session.
        if (next.includeGenres.length === 0 && next.excludeGenres.length === 0 && (local.includeGenres.length > 0 || local.excludeGenres.length > 0)) {
          setIsServerHydrated(true);
          return;
        }

        setFilters(next);
        writePersistedFilters(next);
      } catch {
        // Fall back to local persisted values.
      } finally {
        if (!cancelled) {
          setIsServerHydrated(true);
        }
      }
    };

    void loadServerValue();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    writePersistedFilters(filters);
  }, [filters]);

  useEffect(() => {
    if (!isAuthenticated || !isServerHydrated) {
      return;
    }

    void fetch("/api/new-videos-preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        includeGenres: filters.includeGenres,
        excludeGenres: filters.excludeGenres,
      }),
    }).catch(() => {
      // Keep UI responsive if server persistence is unavailable.
    });
  }, [filters, isAuthenticated, isServerHydrated]);

  const setGenres = (value: string[]) => {
    setFilters({
      includeGenres: normalizeNewVideoGenreFilters(value),
      excludeGenres: [],
    });
  };

  return {
    includeGenres: filters.includeGenres,
    excludeGenres: filters.excludeGenres,
    genres: filters.includeGenres,
    setFilters: (value: NewVideoGenreFilterState) => setFilters(normalizeNewVideoGenreFilterState(value)),
    setGenres,
    isServerHydrated,
  };
}