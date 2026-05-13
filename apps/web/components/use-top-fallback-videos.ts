"use client";

import { useEffect } from "react";

import type { VideoRecord } from "@/lib/catalog";

export function useTopFallbackVideos({
  autoplayEnabled,
  currentVideoId,
  fallbackPoolSize,
  setTopFallbackVideos,
}: {
  autoplayEnabled: boolean;
  currentVideoId: string;
  fallbackPoolSize: number;
  setTopFallbackVideos: (videos: VideoRecord[]) => void;
}) {
  useEffect(() => {
    if (!autoplayEnabled) {
      return;
    }

    let cancelled = false;

    async function loadTopFallbackPool() {
      try {
        const response = await fetch(`/api/videos/top?count=${fallbackPoolSize}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | {
              videos?: VideoRecord[];
              pending?: boolean;
            }
          | null;

        if (!payload || (payload as { pending?: boolean }).pending) {
          return;
        }

        const ids = Array.isArray(payload?.videos)
          ? payload.videos.filter((video): video is VideoRecord => Boolean(video?.id))
          : [];

        if (!cancelled && ids.length > 0) {
          setTopFallbackVideos(ids);
        }
      } catch {
        // Keep existing fallback pool if loading fails.
      }
    }

    void loadTopFallbackPool();

    return () => {
      cancelled = true;
    };
  }, [autoplayEnabled, currentVideoId, fallbackPoolSize, setTopFallbackVideos]);
}
