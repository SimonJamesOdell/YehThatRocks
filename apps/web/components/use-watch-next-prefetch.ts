"use client";

import { useCallback, useEffect, type MutableRefObject } from "react";

import { PENDING_VIDEO_SELECTION_KEY } from "@/lib/storage-keys";
import type { VideoRecord } from "@/lib/catalog";

type CurrentVideoResolvePayloadLike = {
  currentVideo?: { id?: string };
  relatedVideos?: VideoRecord[];
};

type UseWatchNextPrefetchParams = {
  isAuthenticated: boolean;
  watchNextHideSeen: boolean;
  displayedRelatedVideos: VideoRecord[];
  sourceRelatedVideos: VideoRecord[];
  currentVideoId: string;
  isOverlayRoute: boolean;
  prewarmedThumbnailIdsRef: MutableRefObject<Set<string>>;
  prefetchedRelatedIdsRef: MutableRefObject<Set<string>>;
  inFlightCurrentVideoPrefetchRef: MutableRefObject<Set<string>>;
  prefetchBlockedUntilRef: MutableRefObject<number>;
  prefetchFailureCountRef: MutableRefObject<number>;
  currentVideoPrefetchTtlMs: number;
  prefetchFailureBaseBackoffMs: number;
  prefetchFailureMaxBackoffMs: number;
  hasFreshPrefetchedPayload: (videoId: string, now: number) => boolean;
  setPrefetchedPayload: (videoId: string, payload: CurrentVideoResolvePayloadLike, expiresAt: number) => void;
};

export function useWatchNextPrefetch({
  isAuthenticated,
  watchNextHideSeen,
  displayedRelatedVideos,
  sourceRelatedVideos,
  currentVideoId,
  isOverlayRoute,
  prewarmedThumbnailIdsRef,
  prefetchedRelatedIdsRef,
  inFlightCurrentVideoPrefetchRef,
  prefetchBlockedUntilRef,
  prefetchFailureCountRef,
  currentVideoPrefetchTtlMs,
  prefetchFailureBaseBackoffMs,
  prefetchFailureMaxBackoffMs,
  hasFreshPrefetchedPayload,
  setPrefetchedPayload,
}: UseWatchNextPrefetchParams) {
  const prewarmRelatedThumbnail = useCallback((videoId: string) => {
    if (typeof window === "undefined") {
      return;
    }
    if (prewarmedThumbnailIdsRef.current.has(videoId)) {
      return;
    }
    prewarmedThumbnailIdsRef.current.add(videoId);
    const img = new window.Image();
    img.decoding = "async";
    img.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  }, [prewarmedThumbnailIdsRef]);

  const prefetchCurrentVideoPayload = useCallback((videoId: string) => {
    const now = Date.now();
    if (now < prefetchBlockedUntilRef.current) {
      return;
    }
    if (hasFreshPrefetchedPayload(videoId, now)) {
      return;
    }
    if (inFlightCurrentVideoPrefetchRef.current.has(videoId)) {
      return;
    }

    inFlightCurrentVideoPrefetchRef.current.add(videoId);

    const prefetchParams = new URLSearchParams();
    prefetchParams.set("v", videoId);
    if (isAuthenticated && watchNextHideSeen) {
      prefetchParams.set("hideSeen", "1");
    }

    void fetch(`/api/current-video?${prefetchParams.toString()}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
          const backoffMs = Math.min(
            prefetchFailureMaxBackoffMs,
            prefetchFailureBaseBackoffMs * (2 ** prefetchFailureCountRef.current),
          );
          prefetchBlockedUntilRef.current = Date.now() + backoffMs;
          return;
        }

        const data = (await response.json()) as CurrentVideoResolvePayloadLike;
        if (!data.currentVideo?.id) {
          prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
          const backoffMs = Math.min(
            prefetchFailureMaxBackoffMs,
            prefetchFailureBaseBackoffMs * (2 ** prefetchFailureCountRef.current),
          );
          prefetchBlockedUntilRef.current = Date.now() + backoffMs;
          return;
        }

        if (data.currentVideo.id === videoId) {
          prefetchFailureCountRef.current = 0;
          prefetchBlockedUntilRef.current = 0;
          setPrefetchedPayload(videoId, data, Date.now() + currentVideoPrefetchTtlMs);
          for (const related of (data.relatedVideos ?? []).slice(0, 6)) {
            prewarmRelatedThumbnail(related.id);
          }
        }
      })
      .catch(() => {
        prefetchFailureCountRef.current = Math.min(prefetchFailureCountRef.current + 1, 6);
        const backoffMs = Math.min(
          prefetchFailureMaxBackoffMs,
          prefetchFailureBaseBackoffMs * (2 ** prefetchFailureCountRef.current),
        );
        prefetchBlockedUntilRef.current = Date.now() + backoffMs;
      })
      .finally(() => {
        inFlightCurrentVideoPrefetchRef.current.delete(videoId);
      });
  }, [
    currentVideoPrefetchTtlMs,
    hasFreshPrefetchedPayload,
    inFlightCurrentVideoPrefetchRef,
    isAuthenticated,
    prefetchBlockedUntilRef,
    prefetchFailureBaseBackoffMs,
    prefetchFailureCountRef,
    prefetchFailureMaxBackoffMs,
    prewarmRelatedThumbnail,
    setPrefetchedPayload,
    watchNextHideSeen,
  ]);

  const prefetchRelatedSelection = useCallback((video: VideoRecord) => {
    prewarmRelatedThumbnail(video.id);
    if (!prefetchedRelatedIdsRef.current.has(video.id)) {
      prefetchedRelatedIdsRef.current.add(video.id);
      prefetchCurrentVideoPayload(video.id);
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        PENDING_VIDEO_SELECTION_KEY,
        JSON.stringify({
          id: video.id,
          title: video.title,
          channelTitle: video.channelTitle,
          genre: video.genre,
          favourited: video.favourited,
          description: video.description,
        }),
      );
    }
  }, [prefetchCurrentVideoPayload, prefetchedRelatedIdsRef, prewarmRelatedThumbnail]);

  useEffect(() => {
    for (const video of displayedRelatedVideos.slice(0, 6)) {
      prewarmRelatedThumbnail(video.id);
    }
  }, [displayedRelatedVideos, prewarmRelatedThumbnail]);

  useEffect(() => {
    if (isOverlayRoute) {
      return;
    }

    const topTargets = sourceRelatedVideos
      .filter((video) => video.id !== currentVideoId)
      .slice(0, 3);

    if (topTargets.length === 0) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      for (const target of topTargets) {
        prefetchCurrentVideoPayload(target.id);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [currentVideoId, isOverlayRoute, prefetchCurrentVideoPayload, sourceRelatedVideos]);

  return {
    prefetchRelatedSelection,
  };
}
