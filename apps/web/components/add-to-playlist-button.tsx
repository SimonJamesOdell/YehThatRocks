"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type AddToPlaylistButtonProps = {
  videoId: string;
  isAuthenticated?: boolean;
  className?: string;
  compact?: boolean;
};

const LAST_PLAYLIST_ID_KEY = "ytr:last-playlist-id";
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";
const PLAYLIST_CHOOSER_STATE_EVENT = "ytr:playlist-chooser-state";

type PlaylistSummary = {
  id: string;
  name: string;
  itemCount?: number;
  leadVideoId?: string;
};

type CreatedPlaylistPayload = {
  id?: string;
  name?: string;
};

export function AddToPlaylistButton({
  videoId,
  isAuthenticated = true,
  className,
  compact = false,
}: AddToPlaylistButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const activePlaylistId = searchParams.get("pl");
  const [isAdded, setIsAdded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const [isPending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  if (!isAuthenticated) {
    return null;
  }

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerButtonRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const measuredWidth = menuRef.current?.getBoundingClientRect().width ?? 0;
    const measuredHeight = menuRef.current?.getBoundingClientRect().height ?? 0;
    const menuWidth = Math.max(220, measuredWidth);
    const menuHeight = Math.max(120, measuredHeight);
    const gap = 10;

    const desiredLeft = rect.right + gap;
    const maxLeft = Math.max(8, viewportWidth - menuWidth - 8);
    const left = Math.min(desiredLeft, maxLeft);

    let top = rect.top + (rect.height / 2) - (menuHeight / 2);
    if (top + menuHeight > viewportHeight - 8) {
      top = Math.max(8, viewportHeight - menuHeight - 8);
    }
    if (top < 8) {
      top = 8;
    }

    setMenuStyle({
      left,
      top,
    });
  }, []);

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
    setMenuOpen(false);
    setChooserOpen(false);
  }, [searchParamsKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const event = new CustomEvent("ytr:playlist-chooser-state", {
      detail: { isOpen: chooserOpen },
    });
    window.dispatchEvent(event);
  }, [chooserOpen]);

  async function loadPlaylists() {
    const playlistsResponse = await fetch("/api/playlists", {
      cache: "no-store",
    });

    if (playlistsResponse.status === 401 || playlistsResponse.status === 403) {
      return [] as PlaylistSummary[];
    }

    if (!playlistsResponse.ok) {
      throw new Error("playlists-load-failed");
    }

    const payload = (await playlistsResponse.json().catch(() => null)) as
      | {
          playlists?: PlaylistSummary[];
        }
      | null;

    return Array.isArray(payload?.playlists) ? payload.playlists : [];
  }

  async function ensurePlaylistsLoaded() {
    if (playlistsLoaded) {
      return playlists;
    }

    const loaded = await loadPlaylists();
    setPlaylists(loaded);
    setPlaylistsLoaded(true);
    return loaded;
  }

  async function addVideoToPlaylist(playlistId: string) {
    const addResponse = await fetch(
      `/api/playlists/${encodeURIComponent(playlistId)}/items`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId }),
      },
    );

    if (addResponse.status === 401 || addResponse.status === 403) {
      return false;
    }

    if (!addResponse.ok) {
      return false;
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
    }

    return true;
  }

  function markAdded(message?: string) {
    setIsAdded(true);
    setStatusMessage(message ?? "Added");

    window.setTimeout(() => {
      setIsAdded(false);
      setStatusMessage((current) => (current === message || (!message && current === "Added") ? null : current));
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

  function handleAddToNewPlaylist() {
    if (isPending) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      try {
        let createdPlaylistId: string | null = null;
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
            videoIds: [videoId],
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

        const selectedPlaylist = {
          id: created.id,
          name: created.name ?? autoPlaylistName,
        };

        const nextPlaylists = [...playlists, selectedPlaylist];
        setPlaylists(nextPlaylists);
        setPlaylistsLoaded(true);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
          window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
        }

        markAdded("Added");
      } catch {
        // Silent failure
      }
    });
  }

  function handleAddToNewPlaylistAndOpen() {
    if (isPending) {
      return;
    }

    setMenuOpen(false);
    startTransition(async () => {
      try {
        let createdPlaylistId: string | null = null;
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
            videoIds: [videoId],
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

        const selectedPlaylist = {
          id: created.id,
          name: created.name ?? autoPlaylistName,
        };

        const nextPlaylists = [...playlists, selectedPlaylist];
        setPlaylists(nextPlaylists);
        setPlaylistsLoaded(true);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
          window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
        }

        if (createdPlaylistId && selectedPlaylist.id === createdPlaylistId) {
          setActivePlaylist(createdPlaylistId);
        }
        markAdded("Added");
      } catch {
        // Silent failure
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
          window.sessionStorage.setItem("ytr:open-playlist-after-add", openAfter ? "1" : "0");
        }
        if (loadedPlaylists.length === 0) {
          setStatusMessage("No existing playlists");
          window.setTimeout(() => {
            setStatusMessage((current) => (current === "No existing playlists" ? null : current));
          }, 1800);
        }
      } catch {
        // Silent failure for card-level quick-add actions.
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
      } catch {
        // Silent failure for card-level quick-add actions.
      }
    });
  }

  function handleChooseExistingPlaylist(playlistId: string) {
    if (isPending) {
      return;
    }

    const shouldOpen = typeof window !== "undefined" && window.sessionStorage.getItem("ytr:open-playlist-after-add") === "1";
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
            window.sessionStorage.removeItem("ytr:open-playlist-after-add");
            setActivePlaylist(playlistId);
          }
        }

        markAdded("Added");
      } catch {
        // Silent failure for card-level quick-add actions.
      }
    });
  }

  const lastUsedPlaylistId =
    typeof window !== "undefined"
      ? window.localStorage.getItem(LAST_PLAYLIST_ID_KEY)
      : null;

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
            <button
              type="button"
              className="playlistQuickAddMenuAction"
              onClick={() => handleAddToNewPlaylist()}
              disabled={isPending}
            >
              New playlist
            </button>
            <button
              type="button"
              className="playlistQuickAddMenuAction"
              onClick={() => handleAddToNewPlaylistAndOpen()}
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
