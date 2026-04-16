"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";

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

      window.dispatchEvent(new CustomEvent("ytr:overlay-close-request", {
        detail: { href: closeHref },
      }));
      window.dispatchEvent(new CustomEvent("ytr:right-rail-mode", {
        detail: { mode: "playlist", playlistId: createdPlaylistId },
      }));
      router.push(closeHref);

      window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
        detail: {
          playlist: {
            id: createdPlaylistId,
            name: playlistName,
            videos,
            itemCount: videos.length,
          },
        },
      }));

      void fetch(`/api/playlists/${encodeURIComponent(createdPlaylistId)}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds }),
      }).then(async (addAllResponse) => {
        window.dispatchEvent(new Event("ytr:playlists-updated"));

        if (!addAllResponse.ok) {
          return;
        }

        const updatedPlaylist = (await addAllResponse.json().catch(() => null)) as
          | { id?: string; videos?: VideoRecord[]; itemCount?: number; name?: string }
          | null;

        const finalVideos = Array.isArray(updatedPlaylist?.videos) ? updatedPlaylist.videos : videos;
        const finalName = updatedPlaylist?.name ?? playlistName;
        const finalItemCount = updatedPlaylist?.itemCount ?? finalVideos.length;

        window.dispatchEvent(new CustomEvent("ytr:playlist-rail-sync", {
          detail: {
            playlist: {
              id: createdPlaylistId,
              name: finalName,
              videos: finalVideos,
              itemCount: finalItemCount,
            },
          },
        }));
      }).catch(() => {
        window.dispatchEvent(new Event("ytr:playlists-updated"));
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
      disabled={!isAuthenticated || videoIds.length === 0 || isCreatingPlaylistFromArtist}
    >
      {isCreatingPlaylistFromArtist ? "+ Creating..." : "+ New Playlist"}
    </button>
  );
}
