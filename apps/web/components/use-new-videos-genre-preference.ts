"use client";

import { useEffect, useState } from "react";

import { parseJsonOrNull } from "@/lib/parse-json";
import { normalizeNewVideoGenreFilters } from "@/lib/new-video-genre-filters";

const LOCAL_STORAGE_KEY = "ytr:new-videos-genre-filters";

function readPersistedFilters() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [] as string[];
    return normalizeNewVideoGenreFilters(JSON.parse(raw));
  } catch {
    return [] as string[];
  }
}

function writePersistedFilters(filters: string[]) {
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
  const [genres, setGenres] = useState<string[]>([]);
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

        const payload = (await parseJsonOrNull(response)) as { genres?: string[] } | null;
        if (cancelled) {
          return;
        }

        const next = normalizeNewVideoGenreFilters(payload?.genres ?? []);
        setGenres(next);
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
    writePersistedFilters(genres);
  }, [genres]);

  useEffect(() => {
    if (!isAuthenticated || !isServerHydrated) {
      return;
    }

    void fetch("/api/new-videos-preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ genres }),
    }).catch(() => {
      // Keep UI responsive if server persistence is unavailable.
    });
  }, [genres, isAuthenticated, isServerHydrated]);

  return {
    genres,
    setGenres: (value: string[]) => setGenres(normalizeNewVideoGenreFilters(value)),
    isServerHydrated,
  };
}
