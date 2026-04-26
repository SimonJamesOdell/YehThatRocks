"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";

type CategoryCreatePlaylistButtonProps = {
  isAuthenticated: boolean;
  slug: string;
  categoryName: string;
  videos: VideoRecord[];
  seenVideoIds?: string[];
  hideSeenOnly?: boolean;
};

export function CategoryCreatePlaylistButton({
  isAuthenticated,
  slug,
  categoryName,
  videos,
  seenVideoIds = [],
  hideSeenOnly = false,
}: CategoryCreatePlaylistButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isCreatingPlaylistFromCategory, setIsCreatingPlaylistFromCategory] = useState(false);
  const seenVideoIdSet = useMemo(() => new Set(seenVideoIds), [seenVideoIds]);

  const videoIds = useMemo(
    () => videos.map((video) => video.id).filter(Boolean),
    [videos],
  );

  if (!isAuthenticated) {
    return null;
  }

  const collectAllCategoryVideos = async () => {
    const all = new Map<string, VideoRecord>();

    let offset = 0;
    let hasMore = true;
    let requestCount = 0;
    const PAGE_LIMIT = 96;
    const MAX_REQUESTS = 80;

    while (hasMore && requestCount < MAX_REQUESTS) {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      params.set("limit", String(PAGE_LIMIT));

      const response = await fetch(`/api/categories/${encodeURIComponent(slug)}?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("category-videos-collect-failed");
      }

      const payload = (await response.json()) as { videos?: VideoRecord[]; hasMore?: boolean; nextOffset?: number };
      const rows = Array.isArray(payload.videos) ? payload.videos : [];

      for (const row of rows) {
        if (!row?.id || all.has(row.id)) {
          continue;
        }

        all.set(row.id, row);
      }

      const parsedNextOffset = Number(payload.nextOffset);
      const nextOffset = Number.isFinite(parsedNextOffset) ? parsedNextOffset : (offset + rows.length);
      if (nextOffset <= offset) {
        break;
      }

      offset = nextOffset;
      hasMore = Boolean(payload.hasMore);
      requestCount += 1;
    }

    return [...all.values()];
  };

  const createPlaylistFromCategory = async () => {
    if (!isAuthenticated || isCreatingPlaylistFromCategory || videoIds.length === 0) {
      return;
    }

    setIsCreatingPlaylistFromCategory(true);

    let sourceVideos = videos;

    try {
      const collected = await collectAllCategoryVideos();
      if (collected.length > 0) {
        sourceVideos = collected;
      }
    } catch {
      // Fallback to currently loaded chunk when background collection fails.
      sourceVideos = videos;
    }

    const orderedSourceVideos = sourceVideos
      .filter((video) => !seenVideoIdSet.has(video.id))
      .concat(sourceVideos.filter((video) => seenVideoIdSet.has(video.id)));
    const filteredSourceVideos = hideSeenOnly
      ? orderedSourceVideos.filter((video) => !seenVideoIdSet.has(video.id))
      : orderedSourceVideos;
    const sourceVideoIds = filteredSourceVideos.map((video) => video.id).filter(Boolean);

    if (sourceVideoIds.length === 0) {
      setIsCreatingPlaylistFromCategory(false);
      return;
    }

    const playlistName = `${categoryName} ${new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    try {
      const createResponse = await fetch("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: playlistName,
          videoIds: [],
        }),
      });

      if (!createResponse.ok) {
        return;
      }

      const created = (await createResponse.json().catch(() => null)) as { id?: string } | null;
      const createdPlaylistId = created?.id;

      if (!createdPlaylistId) {
        return;
      }

      const currentVideoId = searchParams.get("v");
      const closeHref = currentVideoId
        ? `/?v=${encodeURIComponent(currentVideoId)}&pl=${encodeURIComponent(createdPlaylistId)}&resume=1`
        : `/?pl=${encodeURIComponent(createdPlaylistId)}`;

      dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href: closeHref });
      dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
        mode: "playlist",
        playlistId: createdPlaylistId,
      });
      router.push(closeHref);

      dispatchAppEvent(EVENT_NAMES.PLAYLIST_RAIL_SYNC, {
        playlist: {
          id: createdPlaylistId,
          name: playlistName,
          videos: filteredSourceVideos,
          itemCount: filteredSourceVideos.length,
        },
      });

      void fetch(`/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: sourceVideoIds }),
      }).then(async (addAllResponse) => {
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);

        if (!addAllResponse.ok) {
          return;
        }

        const updatedPlaylist = (await addAllResponse.json().catch(() => null)) as
          | { id?: string; videos?: VideoRecord[]; itemCount?: number; name?: string }
          | null;

        const finalVideos = Array.isArray(updatedPlaylist?.videos) ? updatedPlaylist.videos : filteredSourceVideos;
        const finalName = updatedPlaylist?.name ?? playlistName;
        const finalItemCount = updatedPlaylist?.itemCount ?? finalVideos.length;

        dispatchAppEvent(EVENT_NAMES.PLAYLIST_RAIL_SYNC, {
          playlist: {
            id: createdPlaylistId,
            name: finalName,
            videos: finalVideos,
            itemCount: finalItemCount,
          },
        });
      }).catch(() => {
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
      });
    } finally {
      setIsCreatingPlaylistFromCategory(false);
    }
  };

  return (
    <button
      type="button"
      className="newPageSeenToggle top100CreatePlaylistButton"
      onClick={() => {
        void createPlaylistFromCategory();
      }}
      disabled={videoIds.length === 0 || isCreatingPlaylistFromCategory}
    >
      {isCreatingPlaylistFromCategory ? "+ Creating..." : "+ New Playlist"}
    </button>
  );
}
