"use client";

import { useEffect, useRef, useState } from "react";

type LyricsAvailabilityResponse = {
  available?: boolean;
};

export function useLyricsAvailability(videoId: string): boolean | null {
  const cacheRef = useRef<Map<string, boolean>>(new Map());
  const [lyricsAvailableForCurrentVideo, setLyricsAvailableForCurrentVideo] = useState<boolean | null>(null);

  useEffect(() => {
    if (!videoId) {
      setLyricsAvailableForCurrentVideo(null);
      return;
    }

    const cached = cacheRef.current.get(videoId);
    if (cached !== undefined) {
      setLyricsAvailableForCurrentVideo(cached);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLyricsAvailableForCurrentVideo(null);

    async function loadLyricsAvailability() {
      try {
        const response = await fetch(`/api/lyrics?v=${encodeURIComponent(videoId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as LyricsAvailabilityResponse | null;
        const isAvailable = Boolean(payload?.available);
        cacheRef.current.set(videoId, isAvailable);

        if (!cancelled) {
          setLyricsAvailableForCurrentVideo(isAvailable);
        }
      } catch {
        // Keep button available when availability cannot be determined due to transient errors.
      }
    }

    void loadLyricsAvailability();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [videoId]);

  return lyricsAvailableForCurrentVideo;
}
