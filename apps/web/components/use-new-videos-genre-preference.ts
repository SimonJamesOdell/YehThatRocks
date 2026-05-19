"use client";

import { useEffect, useState } from "react";

import { parseJsonOrNull } from "@/lib/parse-json";
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
    if (!raw) {
      return {
        includeGenres: [],
        excludeGenres: [],
      } satisfies NewVideoGenreFilterState;
    }
    return normalizeNewVideoGenreFilterState(JSON.parse(raw));
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
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Best-effort persistence only.
  }
}

export function useNewVideosGenrePreference(isAuthenticated: boolean) {
  const [filters, setFilters] = useState<NewVideoGenreFilterState>({
    includeGenres: [],
    excludeGenres: [],
  });
  const [isServerHydrated, setIsServerHydrated] = useState(() => !isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      const local = readPersistedFilters();
      setGenres(local);
      setIsServerHydrated(true);
      return;
    }

    let cancelled = false;
    const local = readPersistedFilters();
    setGenres(local);
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
