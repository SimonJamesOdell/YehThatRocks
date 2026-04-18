"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { CloseLink } from "@/components/close-link";
import type { PlaylistSummary } from "@/lib/catalog-data";

const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";

type PlaylistsGridProps = {
  initialPlaylists: PlaylistSummary[];
  isAuthenticated: boolean;
};

type PlaylistsPayload = {
  playlists?: PlaylistSummary[];
};

export function PlaylistsGrid({ initialPlaylists, isAuthenticated }: PlaylistsGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(initialPlaylists);
  const [name, setName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentVideoId = searchParams.get("v");
  const activePlaylistHrefBase = useMemo(() => {
    const params = new URLSearchParams();

    if (currentVideoId) {
      params.set("v", currentVideoId);
      params.set("resume", "1");
    }

    return params;
  }, [currentVideoId]);

  useEffect(() => {
    setIsMounted(true);

    return () => {
      setIsMounted(false);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    async function refreshPlaylists() {
      try {
        const response = await fetch("/api/playlists", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as PlaylistsPayload | null;

        if (!cancelled && Array.isArray(payload?.playlists)) {
          setPlaylists(payload.playlists);
        }
      } catch {
        // Keep server-rendered playlists when refresh fails.
      }
    }

    void refreshPlaylists();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!showCreateModal) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCreateModal(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showCreateModal]);

  function openCreateModal() {
    if (!isAuthenticated) {
      setMessage("Sign in to create playlists.");
      return;
    }

    setName("");
    setMessage(null);
    setShowCreateModal(true);
  }

  function createPlaylist() {
    if (!isAuthenticated) {
      setMessage("Sign in to create playlists.");
      return;
    }

    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      setMessage("Playlist name must be at least 2 characters.");
      return;
    }

    startTransition(async () => {
      setMessage(null);

      try {
        const response = await fetch("/api/playlists", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
            videoIds: [],
          }),
        });

        if (response.status === 401 || response.status === 403) {
          setMessage("Sign in to create playlists.");
          return;
        }

        if (!response.ok) {
          setMessage("Could not create playlist. Please try again.");
          return;
        }

        setName("");
        setShowCreateModal(false);

        const refreshResponse = await fetch("/api/playlists", {
          method: "GET",
          cache: "no-store",
        });

        if (refreshResponse.ok) {
          const payload = (await refreshResponse.json().catch(() => null)) as PlaylistsPayload | null;

          if (Array.isArray(payload?.playlists)) {
            setPlaylists(payload.playlists);
            window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
          }
        }
      } catch {
        setMessage("Could not create playlist. Please try again.");
      }
    });
  }

  function openPlaylist(playlistId: string) {
    const params = new URLSearchParams(activePlaylistHrefBase.toString());
    params.set("pl", playlistId);
    router.push(`/?${params.toString()}`);
  }

  function removePlaylist(playlistId: string) {
    if (!isAuthenticated) {
      setMessage("Sign in to manage playlists.");
      return;
    }

    startTransition(async () => {
      setPendingDeleteId(playlistId);
      setMessage(null);

      try {
        const response = await fetch(`/api/playlists/${playlistId}`, {
          method: "DELETE",
        });

        if (response.status === 401 || response.status === 403) {
          setMessage("Sign in to manage playlists.");
          return;
        }

        if (!response.ok) {
          setMessage("Could not delete playlist. Please try again.");
          return;
        }

        setPlaylists((current) => current.filter((playlist) => playlist.id !== playlistId));
        window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      } catch {
        setMessage("Could not delete playlist. Please try again.");
      } finally {
        setPendingDeleteId(null);
      }
    });
  }

  return (
    <>
      <div className="favouritesBlindBar playlistsHeaderBar">
        <div className="playlistsHeaderTitle">
          <strong><span className="whitePlaylistGlyph" aria-hidden="true">♬</span> Playlists</strong>
          <button
            type="button"
            className="playlistsPrimaryButton playlistsHeaderCreateButton"
            onClick={openCreateModal}
            disabled={isPending}
            aria-label="Create playlist"
            title="Create playlist"
          >
            +
          </button>
        </div>
        <CloseLink />
      </div>

      {playlists.length > 0 ? (
        <div className="catalogGrid favouritesCatalogGrid">
          {playlists.map((playlist) => {
            const isDeleting = pendingDeleteId === playlist.id;
            const hasLeadThumbnail =
              playlist.itemCount > 0 && playlist.leadVideoId !== "__placeholder__";

            return (
              <article
                key={playlist.id}
                className="catalogCard categoryCard favouritesCardCompact playlistCardInteractive"
                role="link"
                tabIndex={0}
                aria-label={`Set ${playlist.name} as active playlist`}
                onClick={() => openPlaylist(playlist.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openPlaylist(playlist.id);
                  }
                }}
              >
                <div className="favouritesThumbOverlayWrap">
                  {hasLeadThumbnail ? (
                    <div className="categoryThumbWrap">
                      <Image
                        src={`https://i.ytimg.com/vi/${playlist.leadVideoId}/mqdefault.jpg`}
                        alt=""
                        width={320}
                        height={180}
                        className="categoryThumb"
                        loading="lazy"
                        sizes="(max-width: 768px) 92vw, (max-width: 1200px) 44vw, 320px"
                      />
                    </div>
                  ) : (
                    <div className="categoryThumbWrap playlistThumbEmpty" aria-hidden="true">
                      <span className="playlistThumbEmptyGlyph">♬</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="favouritesDeleteButton favouritesDeleteOverlayButton"
                    onClick={(event) => {
                      event.stopPropagation();
                      removePlaylist(playlist.id);
                    }}
                    disabled={!isAuthenticated || isPending || isDeleting}
                    aria-label={`Delete playlist ${playlist.name}`}
                    title="Delete playlist"
                  >
                    {isDeleting ? "…" : "🗑"}
                  </button>
                  <button
                    type="button"
                    className="favouritesDeleteButton favouritesEditOverlayButton"
                    onClick={(event) => {
                      event.stopPropagation();
                      const params = new URLSearchParams();
                      params.set("name", playlist.name);
                      router.push(`/playlists/${playlist.id}?${params.toString()}`);
                    }}
                    disabled={!isAuthenticated || isPending || isDeleting}
                    aria-label={`Edit playlist ${playlist.name}`}
                    title="Edit playlist"
                  >
                    ✎
                  </button>
                </div>
                <h3>
                  <span className="cardTitleLink playlistCardTitleStatic">{playlist.name}</span>
                </h3>
                <p>{playlist.itemCount} tracks</p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="favouritesEmptyState" role="status" aria-live="polite">
          <h3>There are no playlists saved yet.</h3>
          <p>Create a playlist to start building your queue.</p>
        </div>
      )}

      {message ? <p className="mutationMessage">{message}</p> : null}
    </>
  );
}
