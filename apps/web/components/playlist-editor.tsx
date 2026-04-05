"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CloseLink } from "@/components/close-link";
import type { PlaylistDetail } from "@/lib/catalog-data";

type PlaylistEditorProps = {
  playlist: PlaylistDetail;
  isAuthenticated: boolean;
};

const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";

function getPlaylistVideoThumbnail(video: { id: string; thumbnail?: string | null }) {
  const thumbnail = video.thumbnail?.trim();
  return thumbnail && thumbnail.length > 0
    ? thumbnail
    : `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`;
}

export function PlaylistEditor({ playlist, isAuthenticated }: PlaylistEditorProps) {
  const router = useRouter();
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [playlistVideos, setPlaylistVideos] = useState(playlist.videos);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  function beginEditingName() {
    setName(playlist.name);
    setError(null);
    setIsEditingName(true);
  }

  function cancelEditingName() {
    setName(playlist.name);
    setError(null);
    setIsEditingName(false);
  }

  function saveName() {
    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      setError("Playlist name must be at least 2 characters.");
      return;
    }

    startTransition(async () => {
      setError(null);

      try {
        const response = await fetch(`/api/playlists/${playlist.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
          }),
        });

        if (response.status === 401 || response.status === 403) {
          setError("Sign in to manage playlists.");
          return;
        }

        if (!response.ok) {
          setError("Could not rename playlist. Please try again.");
          return;
        }

        setIsEditingName(false);
        router.refresh();
      } catch {
        setError("Could not rename playlist. Please try again.");
      }
    });
  }

  function removeTrack(index: number) {
    if (!isAuthenticated || isPending || removingIndex !== null) {
      return;
    }

    setRemovingIndex(index);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/playlists/${playlist.id}/items`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            playlistItemIndex: index,
          }),
        });

        if (response.status === 401 || response.status === 403) {
          setError("Sign in to manage playlists.");
          return;
        }

        if (!response.ok) {
          setError("Could not remove that track. Please try again.");
          return;
        }

        setPlaylistVideos((current) => current.filter((_, itemIndex) => itemIndex !== index));
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
        router.refresh();
      } catch {
        setError("Could not remove that track. Please try again.");
      } finally {
        setRemovingIndex(null);
      }
    });
  }

  function reorderTracksLocally(fromIndex: number, toIndex: number) {
    setPlaylistVideos((current) => {
      const cloned = [...current];
      const [moved] = cloned.splice(fromIndex, 1);

      if (!moved) {
        return current;
      }

      cloned.splice(toIndex, 0, moved);
      return cloned;
    });
  }

  function handleDragStart(index: number) {
    if (!isAuthenticated || isPending || removingIndex !== null) {
      return;
    }

    setDraggingIndex(index);
    setDropTargetIndex(index);
    setError(null);
  }

  function handleDragOver(index: number, event: React.DragEvent<HTMLDivElement>) {
    if (draggingIndex === null) {
      return;
    }

    event.preventDefault();
    if (dropTargetIndex !== index) {
      setDropTargetIndex(index);
    }
  }

  function resetDragState() {
    setDraggingIndex(null);
    setDropTargetIndex(null);
  }

  function handleDrop(index: number, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (draggingIndex === null) {
      resetDragState();
      return;
    }

    const fromIndex = draggingIndex;
    const toIndex = index;
    resetDragState();

    if (fromIndex === toIndex) {
      return;
    }

    const previous = [...playlistVideos];
    reorderTracksLocally(fromIndex, toIndex);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/playlists/${playlist.id}/items`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fromIndex,
            toIndex,
          }),
        });

        if (response.status === 401 || response.status === 403) {
          setError("Sign in to manage playlists.");
          setPlaylistVideos(previous);
          return;
        }

        if (!response.ok) {
          setError("Could not reorder tracks. Please try again.");
          setPlaylistVideos(previous);
          return;
        }

        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
        router.refresh();
      } catch {
        setError("Could not reorder tracks. Please try again.");
        setPlaylistVideos(previous);
      }
    });
  }

  return (
    <>
      <div className="favouritesBlindBar">
        <div className="playlistEditorBreadcrumb">
          <strong className="playlistEditorHeading">
            <span className="whitePlaylistGlyph" aria-hidden="true">♬</span>
            <Link href="/playlists" className="playlistEditorHeadingLink">Playlists</Link>
          </strong>
          <span className="playlistEditorHeadingSeparator" aria-hidden="true">/</span>
          {isEditingName ? (
            <span className="playlistEditorTitleWrap">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="playlistsNameInput playlistEditorNameInput"
                aria-label="Playlist name"
                autoFocus
                disabled={isPending}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveName();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEditingName();
                  }
                }}
              />
              <button
                type="button"
                className="playlistsPrimaryButton playlistEditorNameAction"
                onClick={saveName}
                disabled={isPending}
              >
                Save
              </button>
              <button
                type="button"
                className="playlistsSecondaryButton playlistEditorNameAction"
                onClick={cancelEditingName}
                disabled={isPending}
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="playlistEditorTitleWrap">
              <span className="playlistEditorCurrentName">{playlist.name}</span>
              <button
                type="button"
                className="favouritesDeleteButton playlistEditorInlineEditButton"
                onClick={beginEditingName}
                disabled={!isAuthenticated || isPending}
                aria-label={`Edit playlist ${playlist.name}`}
                title="Edit playlist name"
              >
                ✎
              </button>
            </span>
          )}
        </div>
        <CloseLink />
      </div>

      {error ? <p className="mutationMessage">{error}</p> : null}

      <section className="playlistEditorContent">
        {playlistVideos.length > 0 ? (
          <div className="trackStack">
            {playlistVideos.map((video, index) => (
              <div
                key={`${video.id}-${index}`}
                className={`trackCard linkedCard leaderboardCard playlistEditorTrackRow${dropTargetIndex === index ? " playlistEditorTrackRowDropTarget" : ""}`}
                draggable={isAuthenticated && !isPending && removingIndex === null}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(index, event)}
                onDrop={(event) => handleDrop(index, event)}
                onDragEnd={resetDragState}
              >
                <Link
                  href={`/?v=${video.id}&pl=${encodeURIComponent(playlist.id)}&pli=${index}`}
                  className="leaderboardTrackLink"
                >
                  <div className="leaderboardRank">#{index + 1}</div>
                  <div className="leaderboardThumbWrap">
                    <Image
                      src={getPlaylistVideoThumbnail(video)}
                      alt=""
                      width={160}
                      height={90}
                      className="leaderboardThumb"
                      loading="lazy"
                    />
                  </div>
                  <div className="leaderboardMeta">
                    <h3>{video.title}</h3>
                  </div>
                </Link>
                <button
                  type="button"
                  className="favouritesDeleteButton playlistEditorTrackDelete"
                  onClick={() => removeTrack(index)}
                  disabled={!isAuthenticated || isPending || removingIndex !== null}
                  aria-label={`Remove ${video.title} from playlist`}
                  title="Remove track from playlist"
                >
                  {removingIndex === index ? "..." : "✕"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="playlistEditorEmptyState" role="status" aria-live="polite">
            <p>No videos added yet.</p>
          </div>
        )}

      </section>
    </>
  );
}