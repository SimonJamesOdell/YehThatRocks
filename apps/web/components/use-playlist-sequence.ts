"use client";

import { useEffect, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { EVENT_NAMES, listenToAppEvent } from "@/lib/events-contract";

type PlaylistPayload = {
  id: string;
  videos: VideoRecord[];
};

export type UsePlaylistSequenceReturn = {
  playlistQueueIds: string[];
  setPlaylistQueueIds: React.Dispatch<React.SetStateAction<string[]>>;
  playlistQueueOwnerId: string | null;
  setPlaylistQueueOwnerId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function usePlaylistSequence({
  activePlaylistId,
  isLoggedIn,
}: {
  activePlaylistId: string | null;
  isLoggedIn: boolean;
}): UsePlaylistSequenceReturn {
  const [playlistQueueIds, setPlaylistQueueIds] = useState<string[]>([]);
  const [playlistQueueOwnerId, setPlaylistQueueOwnerId] = useState<string | null>(null);
  const [playlistRefreshTick, setPlaylistRefreshTick] = useState(0);

  useEffect(() => {
    const unsubscribe = listenToAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, () => {
      setPlaylistRefreshTick((current) => current + 1);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !activePlaylistId) {
      setPlaylistQueueIds([]);
      setPlaylistQueueOwnerId(null);
      return;
    }

    const playlistId = activePlaylistId;
    let cancelled = false;

    // Prevent stale tracks from previous playlist driving next/autoplay while new playlist loads.
    setPlaylistQueueIds([]);
    setPlaylistQueueOwnerId(null);

    async function loadPlaylistSequence() {
      try {
        const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          if (!cancelled) {
            setPlaylistQueueIds([]);
            setPlaylistQueueOwnerId(null);
          }
          return;
        }

        const payload = (await response.json().catch(() => null)) as PlaylistPayload | null;

        if (!payload || !Array.isArray(payload.videos)) {
          if (!cancelled) {
            setPlaylistQueueIds([]);
            setPlaylistQueueOwnerId(null);
          }
          return;
        }

        const sequenceIds = payload.videos
          .map((video) => video.id)
          .filter((id): id is string => Boolean(id));

        if (!cancelled) {
          setPlaylistQueueIds(sequenceIds);
          setPlaylistQueueOwnerId(playlistId);
        }
      } catch {
        if (!cancelled) {
          setPlaylistQueueIds([]);
          setPlaylistQueueOwnerId(null);
        }
      }
    }

    void loadPlaylistSequence();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, isLoggedIn, playlistRefreshTick]);

  return {
    playlistQueueIds,
    setPlaylistQueueIds,
    playlistQueueOwnerId,
    setPlaylistQueueOwnerId,
  };
}
