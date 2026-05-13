"use client";

import { useCallback, useEffect, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import {
  buildRouteAutoplayPlaylistName,
  buildRouteAutoplayTelemetryMode,
  resolveRouteAutoplaySource,
  type RouteAutoplaySource,
} from "@/components/player-experience-autoplay-utils";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { createPlaylistClient } from "@/lib/playlist-client-service";

export function useRouteAutoplayQueue({
  activePlaylistId,
  isDockedDesktop,
  pathname,
  isLoggedIn,
  fetchWithAuthRetry,
  newAutoplayPlaylistSize,
  routeAutoplayQueueSyncEvent,
}: {
  activePlaylistId: string | null;
  isDockedDesktop: boolean;
  pathname: string;
  isLoggedIn: boolean;
  fetchWithAuthRetry: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  newAutoplayPlaylistSize: number;
  routeAutoplayQueueSyncEvent: string;
}) {
  const [routeAutoplayQueueIds, setRouteAutoplayQueueIds] = useState<string[]>([]);

  const extractVideoIds = useCallback((videos: VideoRecord[] | undefined) => (
    Array.isArray(videos)
      ? videos.map((video) => video?.id).filter((id): id is string => Boolean(id))
      : []
  ), []);

  const fetchHiddenVideoIdSet = useCallback(async () => {
    if (!isLoggedIn) {
      return new Set<string>();
    }

    try {
      const hiddenResponse = await fetchWithAuthRetry("/api/hidden-videos", { cache: "no-store" });
      if (!hiddenResponse.ok) {
        return new Set<string>();
      }

      const hiddenPayload = (await hiddenResponse.json().catch(() => null)) as { hiddenVideoIds?: string[] } | null;
      return new Set(Array.isArray(hiddenPayload?.hiddenVideoIds) ? hiddenPayload.hiddenVideoIds : []);
    } catch {
      return new Set<string>();
    }
  }, [fetchWithAuthRetry, isLoggedIn]);

  const fetchAutoplaySourceVideoIds = useCallback(async (source: RouteAutoplaySource) => {
    if (source.type === "new") {
      const response = await fetch(`/api/videos/newest?skip=0&take=${newAutoplayPlaylistSize}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return [] as string[];
      }

      const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
      return extractVideoIds(payload?.videos);
    }

    if (source.type === "top100") {
      const response = await fetch(`/api/videos/top?count=${newAutoplayPlaylistSize}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return [] as string[];
      }

      const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
      return extractVideoIds(payload?.videos);
    }

    if (source.type === "favourites") {
      const favouritesResponse = await fetchWithAuthRetry("/api/favourites", {
        cache: "no-store",
      });

      if (!favouritesResponse.ok) {
        return [] as string[];
      }

      const payload = (await favouritesResponse.json().catch(() => null)) as { favourites?: VideoRecord[] } | null;
      return Array.isArray(payload?.favourites)
        ? payload.favourites.map((video) => video?.id).filter((id): id is string => Boolean(id))
        : [];
    }

    if (source.type === "category") {
      const response = await fetch(
        `/api/categories/${encodeURIComponent(source.slug)}?limit=96&offset=0`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return [] as string[];
      }

      const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
      return extractVideoIds(payload?.videos);
    }

    const response = await fetch(`/api/artists/${encodeURIComponent(source.slug)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [] as string[];
    }

    const payload = (await response.json().catch(() => null)) as { videos?: VideoRecord[] } | null;
    return extractVideoIds(payload?.videos);
  }, [extractVideoIds, fetchWithAuthRetry, newAutoplayPlaylistSize]);

  const buildRouteAutoplayPlaylist = useCallback(async (source: RouteAutoplaySource) => {
    if (!isLoggedIn) {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }

    try {
      const [rawVideoIds, hiddenSet] = await Promise.all([
        fetchAutoplaySourceVideoIds(source),
        fetchHiddenVideoIdSet(),
      ]);

      const filteredVideoIds = Array.from(new Set(rawVideoIds.filter((videoId) => !hiddenSet.has(videoId)))).slice(
        0,
        newAutoplayPlaylistSize,
      );
      const firstVideoId = filteredVideoIds[0] ?? null;

      if (!firstVideoId) {
        return { playlistId: null as string | null, firstVideoId: null as string | null };
      }

      const createResponse = await createPlaylistClient(
        {
          name: buildRouteAutoplayPlaylistName(source),
          videoIds: filteredVideoIds,
        },
        { telemetryContext: { component: "player-experience-core", mode: buildRouteAutoplayTelemetryMode(source) } },
      );

      if (!createResponse.ok) {
        return { playlistId: null as string | null, firstVideoId };
      }

      const playlistPayload = createResponse.data as { id?: string };
      const playlistId = typeof playlistPayload?.id === "string" ? playlistPayload.id : null;

      if (playlistId) {
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
      }

      return {
        playlistId,
        firstVideoId,
      };
    } catch {
      return { playlistId: null as string | null, firstVideoId: null as string | null };
    }
  }, [fetchAutoplaySourceVideoIds, fetchHiddenVideoIdSet, isLoggedIn, newAutoplayPlaylistSize]);

  useEffect(() => {
    if (!isDockedDesktop || Boolean(activePlaylistId)) {
      setRouteAutoplayQueueIds([]);
      return;
    }

    const autoplaySource = resolveRouteAutoplaySource(pathname);

    if (!autoplaySource) {
      setRouteAutoplayQueueIds([]);
      return;
    }

    let cancelled = false;
    const routeAutoplaySource = autoplaySource;
    let receivedSyncedQueue = false;

    const handleRouteQueueSync = (event: Event) => {
      if (routeAutoplaySource.type !== "new" && routeAutoplaySource.type !== "top100") {
        return;
      }

      const detail = (event as CustomEvent<{ source?: string; videoIds?: string[] }>).detail;
      if (detail?.source !== routeAutoplaySource.type || !Array.isArray(detail.videoIds)) {
        return;
      }

      receivedSyncedQueue = true;
      setRouteAutoplayQueueIds(Array.from(new Set(detail.videoIds.filter((videoId): videoId is string => Boolean(videoId)))));
    };

    if (typeof window !== "undefined" && (routeAutoplaySource.type === "new" || routeAutoplaySource.type === "top100")) {
      window.addEventListener(routeAutoplayQueueSyncEvent, handleRouteQueueSync as EventListener);
    }

    async function loadRouteAutoplayQueue() {
      try {
        const [hiddenSet, rawIds] = await Promise.all([
          fetchHiddenVideoIdSet(),
          fetchAutoplaySourceVideoIds(routeAutoplaySource),
        ]);

        const dedupedVisibleIds = Array.from(new Set(rawIds.filter((videoId) => !hiddenSet.has(videoId))));

        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds(dedupedVisibleIds);
        }
      } catch {
        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds([]);
        }
      }
    }

    void loadRouteAutoplayQueue();

    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && (routeAutoplaySource.type === "new" || routeAutoplaySource.type === "top100")) {
        window.removeEventListener(routeAutoplayQueueSyncEvent, handleRouteQueueSync as EventListener);
      }
    };
  }, [activePlaylistId, fetchAutoplaySourceVideoIds, fetchHiddenVideoIdSet, isDockedDesktop, pathname, routeAutoplayQueueSyncEvent]);

  useEffect(() => {
    const nonDockedRouteQueueSource =
      !isDockedDesktop
      && (pathname === "/new" || pathname === "/top100")
      && !activePlaylistId;

    if (!nonDockedRouteQueueSource) {
      return;
    }

    const routeSourceType = pathname === "/new" ? "new" : "top100";

    let cancelled = false;
    let receivedSyncedQueue = false;

    const handleRouteQueueSync = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; videoIds?: string[] }>).detail;
      if (detail?.source !== routeSourceType || !Array.isArray(detail.videoIds)) {
        return;
      }

      receivedSyncedQueue = true;
      setRouteAutoplayQueueIds(Array.from(new Set(detail.videoIds.filter((videoId): videoId is string => Boolean(videoId)))));
    };

    if (typeof window !== "undefined") {
      window.addEventListener(routeAutoplayQueueSyncEvent, handleRouteQueueSync as EventListener);
    }

    async function loadRouteAutoplayQueue() {
      try {
        const [hiddenSet, rawIds] = await Promise.all([
          fetchHiddenVideoIdSet(),
          fetchAutoplaySourceVideoIds({ type: routeSourceType }),
        ]);

        const dedupedVisibleIds = Array.from(new Set(rawIds.filter((videoId) => !hiddenSet.has(videoId))));

        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds(dedupedVisibleIds);
        }
      } catch {
        if (!cancelled && !receivedSyncedQueue) {
          setRouteAutoplayQueueIds([]);
        }
      }
    }

    void loadRouteAutoplayQueue();

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(routeAutoplayQueueSyncEvent, handleRouteQueueSync as EventListener);
      }
    };
  }, [activePlaylistId, fetchAutoplaySourceVideoIds, fetchHiddenVideoIdSet, isDockedDesktop, pathname, routeAutoplayQueueSyncEvent]);

  return {
    routeAutoplayQueueIds,
    fetchHiddenVideoIdSet,
    fetchAutoplaySourceVideoIds,
    buildRouteAutoplayPlaylist,
  };
}
