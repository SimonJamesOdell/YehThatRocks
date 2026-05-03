"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { OverlayHeader } from "@/components/overlay-header";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { createPlaylistClient, importPlaylistClient, listPlaylistsClient } from "@/lib/playlist-client-service";
import type { PlaylistSummary } from "@/lib/catalog-data";

type PlaylistsGridProps = {
  initialPlaylists: PlaylistSummary[];
  isAuthenticated: boolean;
};

export function PlaylistsGrid({ initialPlaylists, isAuthenticated }: PlaylistsGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(initialPlaylists);
  const [name, setName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [importSource, setImportSource] = useState("");
  const [importName, setImportName] = useState("");
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
        const response = await listPlaylistsClient({
          telemetryContext: {
            component: "playlists-grid",
            mode: "refresh",
          },
        });

        if (!response.ok) {
          return;
        }

        if (!cancelled) {
          setPlaylists(response.data as PlaylistSummary[]);
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

  function openImportModal() {
    if (!isAuthenticated) {
      setMessage("Sign in to import playlists.");
      return;
    }

    setImportSource("");
    setImportName("");
    setMessage(null);
    setShowImportModal(true);
  }

  function importPlaylistFromYouTube() {
    if (!isAuthenticated) {
      setMessage("Sign in to import playlists.");
      return;
    }

    const trimmedSource = importSource.trim();
    const trimmedName = importName.trim();

    if (!trimmedSource) {
      setMessage("Paste a YouTube playlist URL or playlist ID.");
      return;
    }

    startTransition(async () => {
      setMessage(null);

      try {
        const response = await importPlaylistClient(
          {
            source: trimmedSource,
            name: trimmedName.length >= 2 ? trimmedName : undefined,
          },
          {
            telemetryContext: {
              component: "playlists-grid",
              mode: "import-youtube",
            },
          },
        );

        if (!response.ok && (response.error.code === "unauthorized" || response.error.code === "forbidden")) {
          setMessage("Sign in to import playlists.");
          return;
        }

        if (!response.ok) {
          setMessage(response.error.message || "Could not import playlist from YouTube.");
          return;
        }

        const stats = response.data?.stats;
        const createdPlaylist = response.data?.playlist;
        const resolvedName = createdPlaylist?.name ?? "Imported playlist";
        const matchedCount = Number(stats?.matchedVideoCount ?? 0);
        const importedCount = Number(stats?.importedVideoCount ?? 0);

        setShowImportModal(false);
        setImportSource("");
        setImportName("");
        setMessage(`Imported ${resolvedName} with ${matchedCount} tracks (${importedCount} new videos ingested).`);

        const refreshResponse = await listPlaylistsClient({
          telemetryContext: {
            component: "playlists-grid",
            mode: "refresh-after-import",
          },
        });

        if (refreshResponse.ok) {
          setPlaylists(refreshResponse.data as PlaylistSummary[]);
          dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
        }
      } catch {
        setMessage("Could not import playlist from YouTube.");
      }
    });
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
        const response = await createPlaylistClient({
            name: trimmedName,
            videoIds: [],
          }, {
            telemetryContext: {
              component: "playlists-grid",
              mode: "create",
            },
          },
        );

        if (!response.ok && (response.error.code === "unauthorized" || response.error.code === "forbidden")) {
          setMessage("Sign in to create playlists.");
          return;
        }

        if (!response.ok) {
          setMessage("Could not create playlist. Please try again.");
          return;
        }

        setName("");
        setShowCreateModal(false);

        const refreshResponse = await listPlaylistsClient({
          telemetryContext: {
            component: "playlists-grid",
            mode: "refresh-after-create",
          },
        });

        if (refreshResponse.ok) {
          setPlaylists(refreshResponse.data as PlaylistSummary[]);
          dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
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
        dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
      } catch {
        setMessage("Could not delete playlist. Please try again.");
      } finally {
        setPendingDeleteId(null);
      }
    });
  }

  return (
    <>
      <OverlayHeader
        className="playlistsHeaderBar"
        close={false}
        actions={(
          <>
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
            <button
              type="button"
              className="playlistsPrimaryButton playlistsHeaderCreateButton"
              onClick={openImportModal}
              disabled={isPending}
              aria-label="Import YouTube playlist"
              title="Import YouTube playlist"
            >
              ⇪
            </button>
          </>
        )}
      >
        <div className="playlistsHeaderTitle">
          <strong><span className="whitePlaylistGlyph" aria-hidden="true">♬</span> Playlists</strong>
        </div>
      </OverlayHeader>

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

      {isMounted && showImportModal ? createPortal(
        <div
          className="suggestNewModalBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Import YouTube playlist"
          onClick={() => setShowImportModal(false)}
        >
          <div className="suggestNewModalPanel" onClick={(event) => event.stopPropagation()}>
            <div className="suggestNewModalHeader">
              <h3>Import YouTube Playlist</h3>
              <p className="suggestNewModalMeta">Paste a YouTube playlist URL. Missing videos will be ingested into the catalog.</p>
            </div>

            <label className="newFlagModalField suggestNewModalField" htmlFor="import-playlist-source">
              Playlist URL or ID
            </label>
            <input
              className="suggestNewModalInput"
              id="import-playlist-source"
              value={importSource}
              onChange={(event) => setImportSource(event.currentTarget.value)}
              placeholder="https://youtube.com/playlist?list=..."
              disabled={isPending}
              maxLength={2048}
            />

            <label className="newFlagModalField suggestNewModalField" htmlFor="import-playlist-name">
              Playlist name (optional)
            </label>
            <input
              className="suggestNewModalInput"
              id="import-playlist-name"
              value={importName}
              onChange={(event) => setImportName(event.currentTarget.value)}
              placeholder="Use source playlist name"
              disabled={isPending}
              maxLength={80}
            />

            <div className="newFlagModalActions">
              <button type="button" className="newFlagModalActionBtn" onClick={() => setShowImportModal(false)} disabled={isPending}>
                Cancel
              </button>
              <button type="button" className="newFlagModalActionBtn" onClick={importPlaylistFromYouTube} disabled={isPending}>
                {isPending ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
