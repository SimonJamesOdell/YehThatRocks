"use client";


import Image from "next/image";
import { useState, useCallback, useEffect, useRef, useTransition, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { addPlaylistItemClient, createPlaylistClient, listPlaylistsClient } from "@/lib/playlist-client-service";
import { LAST_PLAYLIST_ID_KEY, OPEN_PLAYLIST_AFTER_ADD_KEY } from "@/lib/storage-keys";

type AddToPlaylistButtonProps = {
  videoId: string;
  isAuthenticated?: boolean;
  className?: string;
  compact?: boolean;
};

type PlaylistSummary = {
  id: string;
  name: string;
  itemCount?: number;
  leadVideoId?: string;
};


export function AddToPlaylistButton({
  videoId,
  isAuthenticated = true,
  className,
  compact,
}: AddToPlaylistButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const activePlaylistId = searchParams.get("pl");
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerButtonRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportMargin = 10;
    const estimatedMenuWidth = 260;
    const nextLeft = Math.max(
      viewportMargin,
      Math.min(rect.left, window.innerWidth - estimatedMenuWidth - viewportMargin),
    );

    setMenuStyle({
      position: "fixed",
      top: rect.bottom + 8,
      left: nextLeft,
      zIndex: 1300,
    });
  }, []);

  async function loadPlaylists() {
    const result = await listPlaylistsClient({
      telemetryContext: {
        component: "add-to-playlist-button",
      },
    });

    if (!result.ok && (result.error.code === "unauthorized" || result.error.code === "forbidden")) {
      return [] as PlaylistSummary[];
    }

    if (!result.ok) {
      throw new Error("playlists-load-failed");
    }

    return result.data;
  }

  const ensurePlaylistsLoaded = useCallback(async () => {
    if (playlistsLoaded) {
      return playlists;
    }

    const loaded = await loadPlaylists();
    setPlaylists(loaded);
    setPlaylistsLoaded(true);
    return loaded;
  }, [playlists, playlistsLoaded]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handleScroll() {
      setMenuOpen(false);
    }

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!wrapRef.current) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const withinWrap = wrapRef.current.contains(target);
      const withinMenu = menuRef.current?.contains(target) ?? false;

      if (!withinWrap && !withinMenu) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      updateMenuPosition();
    });

    const handleViewportChange = () => {
      updateMenuPosition();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen || playlistsLoaded) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void ensurePlaylistsLoaded().catch((error) => {
        console.error("Failed to load playlists for chooser", error);
      });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [ensurePlaylistsLoaded, menuOpen, playlistsLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !playlistsLoaded) {
      return;
    }

    const lastUsedPlaylistId = window.localStorage.getItem(LAST_PLAYLIST_ID_KEY);
    if (!lastUsedPlaylistId) {
      return;
    }

    const playlistStillExists = playlists.some((playlist) => playlist.id === lastUsedPlaylistId);
    if (!playlistStillExists) {
      window.localStorage.removeItem(LAST_PLAYLIST_ID_KEY);
    }
  }, [playlists, playlistsLoaded]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setMenuOpen(false);
      setChooserOpen(false);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchParamsKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    dispatchAppEvent(EVENT_NAMES.PLAYLIST_CHOOSER_STATE, { isOpen: chooserOpen });
  }, [chooserOpen]);

  async function addVideoToPlaylist(playlistId: string) {
    const result = await addPlaylistItemClient(
      {
        playlistId,
        videoId,
      },
      {
        telemetryContext: {
          component: "add-to-playlist-button",
        },
      },
    );

    if (!result.ok && (result.error.code === "unauthorized" || result.error.code === "forbidden")) {
      return false;
    }

    if (!result.ok) {
      return false;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, playlistId);
      dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
    }

    return true;
  }

  function markAdded(message?: string) {
    setIsAdded(true);

    window.setTimeout(() => {
      setIsAdded(false);
    }, 1800);
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

  function handleMenuToggle() {
    if (isPending) {
      return;
    }

    setMenuOpen((current) => !current);
  }

  function handleAddToNewPlaylist(openAfter: boolean) {
    if (isPending) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      try {
        const autoPlaylistName = `Playlist ${new Date().toLocaleString([], {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}`;

        const createResult = await createPlaylistClient(
          {
            name: autoPlaylistName,
            videoIds: [videoId],
          },
          {
            telemetryContext: {
              component: "add-to-playlist-button",
              mode: openAfter ? "create-add-open" : "create-and-add",
            },
          },
        );

        if (!createResult.ok) {
          return;
        }

        const created = createResult.data;
        if (!created?.id) {
          return;
        }

        const createdPlaylistId = created.id;

        const selectedPlaylist = {
          id: created.id,
          name: created.name ?? autoPlaylistName,
        };

        const nextPlaylists = [...playlists, selectedPlaylist];
        setPlaylists(nextPlaylists);
        setPlaylistsLoaded(true);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
          dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
        }

        if (openAfter) {
          if (createdPlaylistId && selectedPlaylist.id === createdPlaylistId) {
            setActivePlaylist(createdPlaylistId);
          }
        }

        markAdded("Added");
      } catch (err) {
        // Log error for observability
        console.error("[AddToPlaylist] Failed to create playlist:", err);
      }
    });
  }

  function handleOpenExistingChooser(openAfter: boolean = false) {
    if (isPending) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      try {
        const loadedPlaylists = await ensurePlaylistsLoaded();
        setChooserOpen(true);
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(OPEN_PLAYLIST_AFTER_ADD_KEY, openAfter ? "1" : "0");
        }
        if (loadedPlaylists.length === 0) {
          // Keep behavior unchanged for empty state: chooser opens and shows static empty message.
        }
      } catch (err) {
        // Log error for observability
        console.error("[AddToPlaylist] Failed to open existing chooser:", err);
      }
    });
  }

  function handleAddToCurrentPlaylist() {
    if (isPending || !activePlaylistId) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      try {
        const ok = await addVideoToPlaylist(activePlaylistId);
        if (!ok) {
          return;
        }

        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, activePlaylistId);
        }

        markAdded("Added");
      } catch (err) {
        // Log error for observability
        console.error("[AddToPlaylist] Failed to add to current playlist:", err);
      }
    });
  }

  function handleAddToSamePlaylist() {
    if (isPending || activePlaylistId) {
      return;
    }

    const samePlaylistId = typeof window !== "undefined"
      ? window.localStorage.getItem(LAST_PLAYLIST_ID_KEY)
      : null;

    if (!samePlaylistId) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      try {
        const ok = await addVideoToPlaylist(samePlaylistId);
        if (!ok) {
          return;
        }

        markAdded("Added");
      } catch (err) {
        // Log error for observability
        console.error("[AddToPlaylist] Failed to add to chosen playlist:", err);
      }
    });
  }

  function handleChooseExistingPlaylist(playlistId: string) {
    if (isPending) {
      return;
    }

    const shouldOpen = typeof window !== "undefined" && window.sessionStorage.getItem(OPEN_PLAYLIST_AFTER_ADD_KEY) === "1";
    setChooserOpen(false);
    startTransition(async () => {
      try {
        const ok = await addVideoToPlaylist(playlistId);
        if (!ok) {
          return;
        }

        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, playlistId);
          if (shouldOpen) {
            window.sessionStorage.removeItem(OPEN_PLAYLIST_AFTER_ADD_KEY);
            setActivePlaylist(playlistId);
          }
        }

        markAdded("Added");
      } catch (err) {
        console.error("[AddToPlaylist] Failed to add to selected playlist:", err);
      }
    });
  }

  const lastUsedPlaylistId =
    typeof window !== "undefined"
      ? window.localStorage.getItem(LAST_PLAYLIST_ID_KEY)
      : null;
  const samePlaylistId =
    activePlaylistId || !lastUsedPlaylistId || !playlists.some((playlist) => playlist.id === lastUsedPlaylistId)
      ? null
      : lastUsedPlaylistId;

  const chooserPlaylists = (activePlaylistId
    ? playlists.filter((playlist) => playlist.id !== activePlaylistId)
    : playlists
  ).sort((left, right) => {
    if (left.id === lastUsedPlaylistId) {
      return -1;
    }

    if (right.id === lastUsedPlaylistId) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="playlistQuickAddWrap" ref={wrapRef}>
      <button
        ref={triggerButtonRef}
        type="button"
        className={className ?? (isAdded ? "playlistQuickAddButton playlistQuickAddButtonAdded" : "playlistQuickAddButton")}
        onClick={handleMenuToggle}
        disabled={isPending || isAdded}
        aria-label="Add to playlist"
        title="Add to playlist"
      >
        {compact ? "+" : "+ Playlist"}
      </button>
      {menuOpen && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={menuRef}
            className="playlistQuickAddMenu"
            role="menu"
            aria-label="Add to playlist"
            style={menuStyle}
          >
            <div className="playlistQuickAddMenuHeader">
              <strong>Add to...</strong>
              <button
                type="button"
                className="playlistQuickAddMenuClose"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                title="Close"
              >
                ×
              </button>
            </div>
            {activePlaylistId ? (
              <button
                type="button"
                className="playlistQuickAddMenuAction"
                onClick={handleAddToCurrentPlaylist}
                disabled={isPending}
              >
                Current Playlist
              </button>
            ) : null}
            {samePlaylistId ? (
              <button
                type="button"
                className="playlistQuickAddMenuAction"
                onClick={handleAddToSamePlaylist}
                disabled={isPending}
              >
                The same playlist
              </button>
            ) : null}
            <button
              type="button"
              className="playlistQuickAddMenuAction"
              onClick={() => handleAddToNewPlaylist(false)}
              disabled={isPending}
            >
              New playlist
            </button>
            <button
              type="button"
              className="playlistQuickAddMenuAction"
              onClick={() => handleAddToNewPlaylist(true)}
              disabled={isPending}
            >
              New playlist then open
            </button>
            <button
              type="button"
              className="playlistQuickAddMenuAction"
              onClick={() => handleOpenExistingChooser(false)}
              disabled={isPending}
            >
              Existing playlist
            </button>
            <button
              type="button"
              className="playlistQuickAddMenuAction"
              onClick={() => handleOpenExistingChooser(true)}
              disabled={isPending}
            >
              Existing playlist then open
            </button>
          </div>,
          document.body,
        )
        : null}
      {chooserOpen && typeof document !== "undefined"
        ? createPortal(
          <div
            className="playlistQuickAddModalBackdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Choose existing playlist"
            onClick={() => setChooserOpen(false)}
          >
            <div className="playlistQuickAddModal" onClick={(event) => event.stopPropagation()}>
              <div className="playlistQuickAddModalHeader">
                <strong>Choose Playlist</strong>
                <button type="button" onClick={() => setChooserOpen(false)} disabled={isPending}>
                  Close
                </button>
              </div>
              {chooserPlaylists.length === 0 ? (
                <p className="playlistQuickAddStatus">No existing playlists available.</p>
              ) : (
                <div className="playlistQuickAddModalList">
                  {chooserPlaylists.map((playlist) => {
                    const hasLeadThumbnail =
                      (playlist.itemCount ?? 0) > 0 && playlist.leadVideoId !== "__placeholder__";
                    return (
                      <button
                        key={playlist.id}
                        type="button"
                        className="catalogCard categoryCard favouritesCardCompact playlistCardInteractive playlistQuickAddCard"
                        onClick={() => handleChooseExistingPlaylist(playlist.id)}
                        disabled={isPending}
                        aria-label={`Add to ${playlist.name}`}
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
                        </div>
                        <h3>
                          <span className="cardTitleLink playlistCardTitleStatic">{playlist.name}</span>
                        </h3>
                        <p>{playlist.itemCount} tracks</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
