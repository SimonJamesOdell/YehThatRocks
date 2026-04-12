"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

type AddToPlaylistButtonProps = {
  videoId: string;
  isAuthenticated?: boolean;
  className?: string;
};

const LAST_PLAYLIST_ID_KEY = "ytr:last-playlist-id";
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";

type PlaylistSummary = {
  id: string;
  name: string;
  itemCount?: number;
};

type PlaylistDetailPayload = {
  id: string;
  videos?: Array<{ id: string }>;
};

type CreatedPlaylistPayload = {
  id?: string;
  name?: string;
};

export function AddToPlaylistButton({
  videoId,
  isAuthenticated = true,
  className,
}: AddToPlaylistButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isAdded, setIsAdded] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!isAuthenticated) {
    return null;
  }

  function setActivePlaylist(playlistId: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (!params.get("v")) {
      params.set("v", videoId);
    }

    params.set("resume", "1");
    params.set("pl", playlistId);
    params.delete("pli");

    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }

  function addToPlaylist() {
    if (!isAuthenticated || isPending || isAdded) {
      return;
    }

    startTransition(async () => {
      try {
        const playlistsResponse = await fetch("/api/playlists", {
          cache: "no-store",
        });

        if (playlistsResponse.status === 401 || playlistsResponse.status === 403) {
          return;
        }

        if (!playlistsResponse.ok) {
          return;
        }

        const payload = (await playlistsResponse.json().catch(() => null)) as
          | {
              playlists?: PlaylistSummary[];
            }
          | null;

        let playlists = Array.isArray(payload?.playlists) ? payload.playlists : [];
        let createdPlaylistId: string | null = null;

        if (playlists.length === 0) {
          const autoPlaylistName = `Playlist ${new Date().toLocaleString([], {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}`;

          const createResponse = await fetch("/api/playlists", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: autoPlaylistName,
              videoIds: [],
            }),
          });

          if (!createResponse.ok) {
            return;
          }

          const created = (await createResponse.json().catch(() => null)) as CreatedPlaylistPayload | null;
          if (!created?.id) {
            return;
          }

          createdPlaylistId = created.id;

          playlists = [{
            id: created.id,
            name: created.name ?? autoPlaylistName,
          }];
        }

        const lastUsedPlaylistId =
          typeof window !== "undefined"
            ? window.localStorage.getItem(LAST_PLAYLIST_ID_KEY)
            : null;

        const initialSelectedPlaylist =
          playlists.find((playlist) => playlist.id === lastUsedPlaylistId) ?? playlists[0];

        if (!initialSelectedPlaylist) {
          return;
        }

        const candidatePlaylists = [
          initialSelectedPlaylist,
          ...playlists.filter((playlist) => playlist.id !== initialSelectedPlaylist.id),
        ];

        let selectedPlaylist: PlaylistSummary | null = null;

        for (const candidate of candidatePlaylists) {
          try {
            const detailResponse = await fetch(`/api/playlists/${encodeURIComponent(candidate.id)}`, {
              cache: "no-store",
            });

            if (!detailResponse.ok) {
              continue;
            }

            const detailPayload = (await detailResponse.json().catch(() => null)) as PlaylistDetailPayload | null;
            const existingIds = Array.isArray(detailPayload?.videos)
              ? new Set(detailPayload.videos.map((video) => video.id))
              : new Set<string>();

            if (!existingIds.has(videoId)) {
              selectedPlaylist = candidate;
              break;
            }
          } catch {
            // Continue to next candidate playlist.
          }
        }

        if (!selectedPlaylist) {
          return;
        }

        const addResponse = await fetch(
          `/api/playlists/${encodeURIComponent(selectedPlaylist.id)}/items`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ videoId }),
          },
        );

        if (addResponse.status === 401 || addResponse.status === 403) {
          return;
        }

        if (!addResponse.ok) {
          return;
        }

        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, selectedPlaylist.id);
          window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
        }

        if (createdPlaylistId && selectedPlaylist.id === createdPlaylistId) {
          setActivePlaylist(createdPlaylistId);
        }

        setIsAdded(true);

      } catch {
        // Silent failure for card-level quick-add actions.
      }
    });
  }

  return (
    <div className="playlistQuickAddWrap">
      <button
        type="button"
        className={className ?? (isAdded ? "playlistQuickAddButton playlistQuickAddButtonAdded" : "playlistQuickAddButton")}
        onClick={addToPlaylist}
        disabled={isPending || isAdded}
        aria-label="Add to playlist"
        title="Add to playlist"
      >
        + Playlist
      </button>
    </div>
  );
}
