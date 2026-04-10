"use client";

import { useEffect, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { Top100VideoLink } from "@/components/top100-video-link";

type TopVideosPayload = {
  videos?: VideoRecord[];
};

const TOP100_SESSION_CACHE_KEY = "ytr:top100-cache-v1";
const TOP100_SESSION_CACHE_TTL_MS = 60_000;

function dedupeVideos(videos: VideoRecord[]) {
  const seen = new Set<string>();

  return videos.filter((video) => {
    if (seen.has(video.id)) {
      return false;
    }

    seen.add(video.id);
    return true;
  });
}

export function Top100VideosLoader({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const readSessionCache = () => {
      if (typeof window === "undefined") {
        return null;
      }

      try {
        const raw = window.sessionStorage.getItem(TOP100_SESSION_CACHE_KEY);
        if (!raw) {
          return null;
        }

        const parsed = JSON.parse(raw) as { cachedAt?: number; videos?: VideoRecord[] };
        if (!Array.isArray(parsed.videos) || !Number.isFinite(parsed.cachedAt)) {
          return null;
        }

        if (Date.now() - Number(parsed.cachedAt) > TOP100_SESSION_CACHE_TTL_MS) {
          return null;
        }

        return dedupeVideos(parsed.videos).slice(0, 100);
      } catch {
        return null;
      }
    };

    const writeSessionCache = (rows: VideoRecord[]) => {
      if (typeof window === "undefined" || rows.length === 0) {
        return;
      }

      try {
        window.sessionStorage.setItem(
          TOP100_SESSION_CACHE_KEY,
          JSON.stringify({
            cachedAt: Date.now(),
            videos: rows,
          }),
        );
      } catch {
        // Ignore session storage quota issues.
      }
    };

    const cached = readSessionCache();
    if (cached && cached.length > 0) {
      setVideos(cached);
      setIsLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const loadTopVideos = async () => {
      setIsLoading(true);
      setError(null);

      const tryFetch = async () => {
        const response = await fetch("/api/videos/top?count=100", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return [] as VideoRecord[];
        }

        const payload = (await response.json()) as TopVideosPayload;
        return Array.isArray(payload.videos) ? dedupeVideos(payload.videos).slice(0, 100) : [];
      };

      try {
        let received = await tryFetch();
        if (received.length === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          received = await tryFetch();
        }

        if (received.length > 0) {
          if (!cancelled) {
            setVideos(received);
            setIsLoading(false);
            setError(null);
          }
          writeSessionCache(received);
          return;
        }
      } catch {
        // Fall through to friendly error state.
      }

      if (!cancelled) {
        setError("Top 100 is warming up. Please retry in a moment.");
        setIsLoading(false);
      }
    };

    void loadTopVideos();

    return () => {
      cancelled = true;
    };
  }, []);

  if (videos.length === 0) {
    return (
      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy={isLoading}>
        {isLoading ? (
          <>
            <span className="playerBootBars" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span>Loading top 100...</span>
          </>
        ) : (
          <span>{error ?? "Unable to load top 100 right now."}</span>
        )}
      </div>
    );
  }

  return (
    <div className="trackStack spanTwoColumns">
      {videos.map((track, index) => (
        <Top100VideoLink key={track.id} track={track} index={index} isAuthenticated={isAuthenticated} />
      ))}
    </div>
  );
}
