"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { addPlaylistItemsClient, createPlaylistClient } from "@/lib/playlist-client-service";

type ArtistCreatePlaylistButtonProps = {
  isAuthenticated: boolean;
  artistName: string;
  videos: VideoRecord[];
  hideSeenOnly?: boolean;
};

export function ArtistCreatePlaylistButton({
  isAuthenticated,
  artistName,
  videos,
  hideSeenOnly = false,
}: ArtistCreatePlaylistButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isCreatingPlaylistFromArtist, setIsCreatingPlaylistFromArtist] = useState(false);

  const videoIds = useMemo(
    () => videos.map((video) => video.id).filter(Boolean),
    [videos],
  );

  if (!isAuthenticated) {
    return null;
  }

  const createPlaylistFromArtist = async () => {
    if (!isAuthenticated || isCreatingPlaylistFromArtist || videoIds.length === 0) {
      return;
    }

    setIsCreatingPlaylistFromArtist(true);

    const playlistName = `${artistName} ${new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;

    try {
      const createResponse = await createPlaylistClient({
        name: playlistName,
        videoIds: [],
      }, {
        telemetryContext: {
          component: "artist-create-playlist-button",
        },
      });

      if (!createResponse.ok) {
        return;
      }

      const created = createResponse.data as { id?: string };
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
          videos,
          itemCount: videos.length,
        },
      });

      void addPlaylistItemsClient(
        { playlistId: createdPlaylistId, videoIds },
        { telemetryContext: { component: "artist-create-playlist-button" } },
      ).then(async (addAllResponse) => {
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);

        if (!addAllResponse.ok) {
          return;
        }

        const updatedPlaylist = addAllResponse.data as
          | { id?: string; videos?: VideoRecord[]; itemCount?: number; name?: string }
          | undefined;

        const finalVideos = Array.isArray(updatedPlaylist?.videos) ? updatedPlaylist.videos : videos;
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
      setIsCreatingPlaylistFromArtist(false);
    }
  };

  return (
    <button
      type="button"
      className="newPageSeenToggle top100CreatePlaylistButton"
      onClick={() => {
        void createPlaylistFromArtist();
      }}
      disabled={videoIds.length === 0 || isCreatingPlaylistFromArtist}
    >
      {isCreatingPlaylistFromArtist ? "+ Creating..." : "+ New Playlist"}
    </button>
  );
}
