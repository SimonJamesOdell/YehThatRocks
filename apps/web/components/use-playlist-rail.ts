"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { VideoRecord } from "@/lib/catalog";

// ── Constants ──────────────────────────────────────────────────────────────

const WATCH_NEXT_HIDE_ANIMATION_MS = 240;
const PLAYLISTS_UPDATED_EVENT = "ytr:playlists-updated";
const RIGHT_RAIL_MODE_EVENT = "ytr:right-rail-mode";
const PLAYLIST_RAIL_SYNC_EVENT = "ytr:playlist-rail-sync";
const PLAYLIST_CREATION_PROGRESS_EVENT = "ytr:playlist-creation-progress";

// ── Types ──────────────────────────────────────────────────────────────────

export type RightRailMode = "watch-next" | "playlist" | "queue";

export type PlaylistRailVideo = {
  playlistItemId: string;
  id: string;
  title: string;
  channelTitle: string;
  thumbnail?: string | null;
};

export type PlaylistRailPayload = {
  id: string;
  name: string;
  videos: PlaylistRailVideo[];
  itemCount?: number;
};

export type PlaylistRailSummary = {
  id: string;
  name: string;
  itemCount: number;
  leadVideoId: string;
};

export type PlaylistRailState = {
  rightRailMode: RightRailMode;
  setRightRailMode: (mode: RightRailMode) => void;
  playlistRailData: PlaylistRailPayload | null;
  isPlaylistRailLoading: boolean;
  playlistRailError: string | null;
  playlistRailSummaries: PlaylistRailSummary[];
  isPlaylistSummaryLoading: boolean;
  playlistSummaryError: string | null;
  playlistRefreshTick: number;
  setPlaylistRefreshTick: React.Dispatch<React.SetStateAction<number>>;
  playlistMutationMessage: string | null;
  playlistMutationTone: "info" | "success" | "error";
  setPlaylistMutationMessage: (message: string | null) => void;
  setPlaylistMutationTone: (tone: "info" | "success" | "error") => void;
  playlistMutationPendingVideoId: string | null;
  isCreatingRailPlaylist: boolean;
  playlistCreationPendingId: string | null;
  lastAddedRelatedVideoId: string | null;
  recentlyAddedPlaylistTrack: { playlistId: string; trackId: string } | null;
  hidingPlaylistTrackKeys: string[];
  playlistItemMutationPendingKeys: string[];
  draggedPlaylistTrackIndex: number | null;
  dragOverPlaylistTrackIndex: number | null;
  isDeletingActivePlaylist: boolean;
  showDeleteActivePlaylistConfirm: boolean;
  setShowDeleteActivePlaylistConfirm: (show: boolean) => void;
  confirmDeleteRailPlaylist: { id: string; name: string } | null;
  setConfirmDeleteRailPlaylist: (playlist: { id: string; name: string } | null) => void;
  playlistBeingDeletedId: string | null;
  /** Ref to the playlist body scroll container. */
  playlistStackBodyRef: React.RefObject<HTMLDivElement | null>;
  /** Derived: index of the currently active track in the playlist rail. */
  activePlaylistTrackIndex: number | null;
  /** Derived: total track count (rail or summary). */
  activePlaylistTrackCount: number;
  /** True while the playlist is being freshly created via the rail. */
  isCreatingActivePlaylist: boolean;
  getActivatePlaylistHref: (playlistId: string) => string;
  getClosePlaylistHref: () => string;
  handleDeleteActivePlaylist: () => Promise<void>;
  handleDeletePlaylistFromRail: (playlistId: string) => Promise<void>;
  handleCreatePlaylistFromRail: () => Promise<void>;
  handleAddToPlaylistFromWatchNext: (track: VideoRecord) => Promise<void>;
  handleRemoveTrackFromActivePlaylist: (track: PlaylistRailVideo, playlistItemIndex: number) => Promise<void>;
  handleReorderActivePlaylistTrack: (fromIndex: number, toIndex: number) => Promise<void>;
  handleSwitchToWatchNextRail: () => void;
  handlePlaylistTrackDragStart: (event: ReactDragEvent<HTMLDivElement>, index: number) => void;
  handlePlaylistTrackDragOver: (event: ReactDragEvent<HTMLDivElement>, index: number) => void;
  handlePlaylistTrackDrop: (event: ReactDragEvent<HTMLDivElement>, toIndex: number) => void;
  handlePlaylistTrackDragEnd: () => void;
};

// ── Hook ───────────────────────────────────────────────────────────────────

export function usePlaylistRail({
  activePlaylistId,
  requestedPlaylistItemIndex,
  currentVideoId,
  pathname,
  searchParamsString,
  router,
  isAuthenticated,
  fetchWithAuthRetry,
  checkAuthState,
}: {
  activePlaylistId: string | null;
  requestedPlaylistItemIndex: number | null;
  currentVideoId: string;
  pathname: string;
  /** `searchParams.toString()` so the hook can reconstruct URLSearchParams. */
  searchParamsString: string;
  router: AppRouterInstance;
  isAuthenticated: boolean;
  fetchWithAuthRetry: (input: string, init?: RequestInit) => Promise<Response>;
  checkAuthState: () => Promise<"authenticated" | "unauthenticated" | "unavailable">;
}): PlaylistRailState {
  const [rightRailMode, setRightRailMode] = useState<RightRailMode>("watch-next");
  const [playlistRailData, setPlaylistRailData] = useState<PlaylistRailPayload | null>(null);
  const [isPlaylistRailLoading, setIsPlaylistRailLoading] = useState(false);
  const [playlistRailError, setPlaylistRailError] = useState<string | null>(null);
  const [playlistRailSummaries, setPlaylistRailSummaries] = useState<PlaylistRailSummary[]>([]);
  const [isPlaylistSummaryLoading, setIsPlaylistSummaryLoading] = useState(false);
  const [playlistSummaryError, setPlaylistSummaryError] = useState<string | null>(null);
  const [playlistRefreshTick, setPlaylistRefreshTick] = useState(0);
  const [playlistMutationMessage, setPlaylistMutationMessage] = useState<string | null>(null);
  const [playlistMutationTone, setPlaylistMutationTone] = useState<"info" | "success" | "error">("info");
  const [playlistMutationPendingVideoId, setPlaylistMutationPendingVideoId] = useState<string | null>(null);
  const [isCreatingRailPlaylist, setIsCreatingRailPlaylist] = useState(false);
  const [playlistCreationPendingId, setPlaylistCreationPendingId] = useState<string | null>(null);
  const [lastAddedRelatedVideoId, setLastAddedRelatedVideoId] = useState<string | null>(null);
  const [recentlyAddedPlaylistTrack, setRecentlyAddedPlaylistTrack] = useState<{ playlistId: string; trackId: string } | null>(null);
  const [hidingPlaylistTrackKeys, setHidingPlaylistTrackKeys] = useState<string[]>([]);
  const [playlistItemMutationPendingKeys, setPlaylistItemMutationPendingKeys] = useState<string[]>([]);
  const [draggedPlaylistTrackIndex, setDraggedPlaylistTrackIndex] = useState<number | null>(null);
  const [dragOverPlaylistTrackIndex, setDragOverPlaylistTrackIndex] = useState<number | null>(null);
  const [isDeletingActivePlaylist, setIsDeletingActivePlaylist] = useState(false);
  const [showDeleteActivePlaylistConfirm, setShowDeleteActivePlaylistConfirm] = useState(false);
  const [confirmDeleteRailPlaylist, setConfirmDeleteRailPlaylist] = useState<{ id: string; name: string } | null>(null);
  const [playlistBeingDeletedId, setPlaylistBeingDeletedId] = useState<string | null>(null);

  const playlistStackBodyRef = useRef<HTMLDivElement | null>(null);
  const playlistAutoScrollRafRef = useRef<number | null>(null);
  const playlistItemHideTimeoutsRef = useRef<Map<string, number>>(new Map());
  const reorderSeqRef = useRef(0);
  const playlistRailLoadRequestIdRef = useRef(0);
  const playlistRailMutationVersionRef = useRef(0);
  const suppressPlaylistRailAutoSwitchRef = useRef(false);
  // Tracks a playlist created via Watch Next before URL params propagate.
  const pendingCreatedPlaylistIdRef = useRef<string | null>(null);
  const previousActivePlaylistIdRef = useRef<string | null>(activePlaylistId);
  const recentlyAddedPlaylistTrackTimeoutRef = useRef<number | null>(null);

  // ── Right-rail mode sync ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated && rightRailMode === "playlist") {
      setRightRailMode("watch-next");
    }
  }, [isAuthenticated, rightRailMode]);

  useEffect(() => {
    if (isAuthenticated && activePlaylistId && rightRailMode !== "playlist") {
      if (suppressPlaylistRailAutoSwitchRef.current) {
        suppressPlaylistRailAutoSwitchRef.current = false;
        return;
      }
      setRightRailMode("playlist");
    }
  }, [activePlaylistId, isAuthenticated, rightRailMode]);

  useEffect(() => {
    if (pathname !== "/" || activePlaylistId || rightRailMode === "watch-next") {
      return;
    }

    // Only force-reset when returning from an overlay route to home.
    const previousPathname = previousActivePlaylistIdRef.current;
    if (!previousPathname || previousPathname === activePlaylistId) {
      return;
    }

    setRightRailMode("watch-next");
  }, [activePlaylistId, pathname, rightRailMode]);

  useEffect(() => {
    const previousActivePlaylistId = previousActivePlaylistIdRef.current;

    if (previousActivePlaylistId && !activePlaylistId && rightRailMode === "playlist") {
      setRightRailMode("watch-next");
    }

    previousActivePlaylistIdRef.current = activePlaylistId;

    if (activePlaylistId && pendingCreatedPlaylistIdRef.current === activePlaylistId) {
      pendingCreatedPlaylistIdRef.current = null;
    }
  }, [activePlaylistId, rightRailMode]);

  // ── External event listeners ──────────────────────────────────────────────

  useEffect(() => {
    const handlePlaylistsUpdated = () => {
      setPlaylistRefreshTick((current) => current + 1);
    };

    const handlePlaylistRailSync = (event: Event) => {
      const detail = (event as CustomEvent<{ playlist?: PlaylistRailPayload; trackId?: string }>).detail;
      const playlist = detail?.playlist;

      if (!playlist?.id || !Array.isArray(playlist.videos)) {
        return;
      }

      if (rightRailMode !== "playlist") {
        return;
      }

      if (activePlaylistId && playlist.id !== activePlaylistId) {
        return;
      }

      setPlaylistCreationPendingId((currentPendingId) => (
        currentPendingId === playlist.id ? null : currentPendingId
      ));

      setPlaylistRailData(playlist);
      setPlaylistRailError(null);
      setIsPlaylistRailLoading(false);
    };

    const handlePlaylistCreationProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ playlistId?: string; phase?: "creating" | "done" | "failed" }>).detail;
      const playlistId = detail?.playlistId;

      if (!playlistId) {
        return;
      }

      if (detail?.phase === "creating") {
        setPlaylistCreationPendingId(playlistId);
        return;
      }

      setPlaylistCreationPendingId((currentPendingId) => (
        currentPendingId === playlistId ? null : currentPendingId
      ));
    };

    const handleRightRailMode = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: RightRailMode; playlistId?: string; trackId?: string }>).detail;
      const mode = detail?.mode;
      if (mode === "watch-next" || mode === "playlist" || mode === "queue") {
        setRightRailMode(mode);
      }

      if (detail?.playlistId && detail?.trackId) {
        setRecentlyAddedPlaylistTrack({
          playlistId: detail.playlistId,
          trackId: detail.trackId,
        });

        if (recentlyAddedPlaylistTrackTimeoutRef.current !== null) {
          window.clearTimeout(recentlyAddedPlaylistTrackTimeoutRef.current);
        }

        recentlyAddedPlaylistTrackTimeoutRef.current = window.setTimeout(() => {
          setRecentlyAddedPlaylistTrack((current) => (
            current?.playlistId === detail.playlistId && current?.trackId === detail.trackId
              ? null
              : current
          ));
          recentlyAddedPlaylistTrackTimeoutRef.current = null;
        }, 2600);
      }
    };

    window.addEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);
    window.addEventListener(PLAYLIST_RAIL_SYNC_EVENT, handlePlaylistRailSync);
    window.addEventListener(RIGHT_RAIL_MODE_EVENT, handleRightRailMode);
    window.addEventListener(PLAYLIST_CREATION_PROGRESS_EVENT, handlePlaylistCreationProgress);

    return () => {
      window.removeEventListener(PLAYLISTS_UPDATED_EVENT, handlePlaylistsUpdated);
      window.removeEventListener(PLAYLIST_RAIL_SYNC_EVENT, handlePlaylistRailSync);
      window.removeEventListener(RIGHT_RAIL_MODE_EVENT, handleRightRailMode);
      window.removeEventListener(PLAYLIST_CREATION_PROGRESS_EVENT, handlePlaylistCreationProgress);

      if (recentlyAddedPlaylistTrackTimeoutRef.current !== null) {
        window.clearTimeout(recentlyAddedPlaylistTrackTimeoutRef.current);
        recentlyAddedPlaylistTrackTimeoutRef.current = null;
      }
    };
  }, [activePlaylistId, rightRailMode]);

  // ── Load playlist rail data ───────────────────────────────────────────────

  useEffect(() => {
    if (rightRailMode !== "playlist") {
      return;
    }

    if (!activePlaylistId) {
      setPlaylistRailData(null);
      setPlaylistRailError(null);
      setIsPlaylistRailLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++playlistRailLoadRequestIdRef.current;
    const mutationVersionAtStart = playlistRailMutationVersionRef.current;

    const loadPlaylistRail = async () => {
      setIsPlaylistRailLoading(true);
      setPlaylistRailError(null);

      try {
        const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}`, {
          cache: "no-store",
        });

        if (cancelled || requestId !== playlistRailLoadRequestIdRef.current) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          void checkAuthState();
          setPlaylistRailData(null);
          setPlaylistRailError("Sign in to view playlist tracks.");
          return;
        }

        if (!response.ok) {
          setPlaylistRailData(null);
          setPlaylistRailError("Could not load playlist tracks.");
          return;
        }

        const payload = (await response.json()) as PlaylistRailPayload;
        if (
          !cancelled
          && requestId === playlistRailLoadRequestIdRef.current
          && mutationVersionAtStart === playlistRailMutationVersionRef.current
        ) {
          setPlaylistRailData(payload);
          setPlaylistCreationPendingId((currentPendingId) => (
            currentPendingId === payload.id ? null : currentPendingId
          ));
        }
      } catch {
        if (!cancelled && requestId === playlistRailLoadRequestIdRef.current) {
          setPlaylistRailData(null);
          setPlaylistRailError("Could not load playlist tracks.");
        }
      } finally {
        if (!cancelled && requestId === playlistRailLoadRequestIdRef.current) {
          setIsPlaylistRailLoading(false);
        }
      }
    };

    void loadPlaylistRail();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, checkAuthState, fetchWithAuthRetry, pathname, playlistRefreshTick, rightRailMode]);

  // ── Load playlist summaries ───────────────────────────────────────────────

  useEffect(() => {
    if (rightRailMode !== "playlist") {
      return;
    }

    let cancelled = false;

    const loadPlaylistSummaries = async () => {
      setIsPlaylistSummaryLoading(true);
      setPlaylistSummaryError(null);

      try {
        const response = await fetchWithAuthRetry("/api/playlists");

        if (cancelled) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          void checkAuthState();
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Sign in to view playlists.");
          return;
        }

        if (!response.ok) {
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Could not load playlists.");
          return;
        }

        const payload = (await response.json()) as { playlists?: PlaylistRailSummary[] };
        if (!cancelled) {
          setPlaylistRailSummaries(Array.isArray(payload.playlists) ? payload.playlists : []);
        }
      } catch {
        if (!cancelled) {
          setPlaylistRailSummaries([]);
          setPlaylistSummaryError("Could not load playlists.");
        }
      } finally {
        if (!cancelled) {
          setIsPlaylistSummaryLoading(false);
        }
      }
    };

    void loadPlaylistSummaries();

    return () => {
      cancelled = true;
    };
  }, [activePlaylistId, checkAuthState, fetchWithAuthRetry, playlistRefreshTick, rightRailMode]);

  // ── Derived values ────────────────────────────────────────────────────────

  const activePlaylistSummary = activePlaylistId
    ? playlistRailSummaries.find((playlist) => playlist.id === activePlaylistId) ?? null
    : null;

  const activePlaylistTrackCount = playlistRailData
    ? Math.max(playlistRailData.videos.length, playlistRailData.itemCount ?? activePlaylistSummary?.itemCount ?? 0)
    : (activePlaylistSummary?.itemCount ?? 0);

  const matchedPlaylistVideoIndex = playlistRailData
    ? playlistRailData.videos.findIndex((track) => track.id === currentVideoId)
    : -1;

  const hasTrustedRequestedPlaylistItemIndex = requestedPlaylistItemIndex !== null
    && playlistRailData !== null
    && requestedPlaylistItemIndex >= 0
    && requestedPlaylistItemIndex < playlistRailData.videos.length
    && playlistRailData.videos[requestedPlaylistItemIndex]?.id === currentVideoId;

  const activePlaylistTrackIndex = hasTrustedRequestedPlaylistItemIndex
    ? requestedPlaylistItemIndex
    : (matchedPlaylistVideoIndex >= 0 ? matchedPlaylistVideoIndex : null);

  const isCreatingActivePlaylist = Boolean(
    activePlaylistId
    && playlistCreationPendingId === activePlaylistId
    && isPlaylistRailLoading,
  );

  // ── Auto-scroll to active track ───────────────────────────────────────────

  useEffect(() => {
    if (rightRailMode !== "playlist" || !activePlaylistId || isPlaylistRailLoading) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const container = playlistStackBodyRef.current;
      if (!container) {
        return;
      }

      const indexedActiveRow = activePlaylistTrackIndex !== null
        ? container.querySelector(`.playlistRailTrackRow[data-playlist-index="${activePlaylistTrackIndex}"]`) as HTMLElement | null
        : null;
      const fallbackActiveRow = container
        .querySelector(".rightRailPlaylistTrackCard.relatedCardActive")
        ?.closest(".playlistRailTrackRow") as HTMLElement | null;
      const activeRow = indexedActiveRow ?? fallbackActiveRow;

      if (!activeRow) {
        return;
      }

      const topGutterPx = 8;
      const containerRect = container.getBoundingClientRect();
      const rowRect = activeRow.getBoundingClientRect();
      const rowTopInViewport = rowRect.top - containerRect.top;

      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const desiredTop = container.scrollTop + rowTopInViewport - topGutterPx;
      const targetTop = Math.min(maxScrollTop, Math.max(0, desiredTop));

      if (Math.abs(container.scrollTop - targetTop) > 1) {
        if (playlistAutoScrollRafRef.current !== null) {
          window.cancelAnimationFrame(playlistAutoScrollRafRef.current);
          playlistAutoScrollRafRef.current = null;
        }

        const startTop = container.scrollTop;
        const scrollDelta = targetTop - startTop;
        const durationMs = 320;
        const startTime = performance.now();

        const animateScroll = (now: number) => {
          const progress = Math.min(1, (now - startTime) / durationMs);
          const eased = 1 - ((1 - progress) ** 3);
          container.scrollTop = startTop + (scrollDelta * eased);

          if (progress < 1) {
            playlistAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
            return;
          }

          playlistAutoScrollRafRef.current = null;
        };

        playlistAutoScrollRafRef.current = window.requestAnimationFrame(animateScroll);
      }
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
      if (playlistAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(playlistAutoScrollRafRef.current);
        playlistAutoScrollRafRef.current = null;
      }
    };
  }, [
    activePlaylistId,
    activePlaylistTrackIndex,
    currentVideoId,
    isPlaylistRailLoading,
    rightRailMode,
    playlistRailData?.videos.length,
  ]);

  // ── Misc side-effect cleanups ─────────────────────────────────────────────

  useEffect(() => {
    if (!activePlaylistId) {
      setShowDeleteActivePlaylistConfirm(false);
    }
  }, [activePlaylistId]);

  useEffect(() => {
    if (rightRailMode !== "playlist") {
      setConfirmDeleteRailPlaylist(null);
    }
  }, [rightRailMode]);

  useEffect(() => {
    if (!playlistMutationMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPlaylistMutationMessage(null);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [playlistMutationMessage]);

  useEffect(() => {
    if (!lastAddedRelatedVideoId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLastAddedRelatedVideoId(null);
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lastAddedRelatedVideoId]);

  useEffect(() => {
    const playlistHideTimeouts = playlistItemHideTimeoutsRef.current;
    return () => {
      for (const timeoutId of playlistHideTimeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      playlistHideTimeouts.clear();
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function buildGeneratedPlaylistName() {
    const now = new Date();
    const datePart = now.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const timePart = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Playlist ${datePart} ${timePart}`;
  }

  function getActivatePlaylistHref(playlistId: string) {
    const params = new URLSearchParams(searchParamsString);
    params.set("v", currentVideoId);
    params.set("resume", "1");
    params.set("pl", playlistId);
    params.delete("pli");
    return `/?${params.toString()}`;
  }

  function getClosePlaylistHref() {
    const params = new URLSearchParams(searchParamsString);
    params.set("v", currentVideoId);
    params.set("resume", "1");
    params.delete("pl");
    params.delete("pli");
    const query = params.toString();
    return query.length > 0 ? `/?${query}` : "/";
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  const commitPlaylistTrackRemoval = useCallback((slotKey: string, playlistItemIndex: number) => {
    setHidingPlaylistTrackKeys((previous) => {
      if (previous.includes(slotKey)) {
        return previous;
      }
      return [...previous, slotKey];
    });

    const existingTimeoutId = playlistItemHideTimeoutsRef.current.get(slotKey);
    if (existingTimeoutId !== undefined) {
      window.clearTimeout(existingTimeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      setPlaylistRailData((previous) => {
        if (!previous) {
          return previous;
        }
        if (playlistItemIndex < 0 || playlistItemIndex >= previous.videos.length) {
          return previous;
        }
        return {
          ...previous,
          videos: previous.videos.filter((_, index) => index !== playlistItemIndex),
        };
      });
      setHidingPlaylistTrackKeys((previous) => previous.filter((candidateKey) => candidateKey !== slotKey));
      playlistItemHideTimeoutsRef.current.delete(slotKey);
    }, WATCH_NEXT_HIDE_ANIMATION_MS);

    playlistItemHideTimeoutsRef.current.set(slotKey, timeoutId);
  }, []);

  const handleDeleteActivePlaylist = useCallback(async () => {
    if (!activePlaylistId || isDeletingActivePlaylist) {
      return;
    }

    setIsDeletingActivePlaylist(true);

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not delete playlist.");
        return;
      }

      window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      setPlaylistRailData(null);
      setPlaylistRailError(null);
      router.push(getClosePlaylistHref());
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Could not delete playlist.");
    } finally {
      setIsDeletingActivePlaylist(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaylistId, fetchWithAuthRetry, isDeletingActivePlaylist, router, searchParamsString, currentVideoId]);

  const handleDeletePlaylistFromRail = useCallback(async (playlistId: string) => {
    if (playlistBeingDeletedId) {
      return;
    }

    setPlaylistBeingDeletedId(playlistId);

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(playlistId)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return;
      }

      window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      setPlaylistRailSummaries((current) => current.filter((p) => p.id !== playlistId));
    } catch {
      // Silent failure
    } finally {
      setPlaylistBeingDeletedId(null);
    }
  }, [fetchWithAuthRetry, playlistBeingDeletedId]);

  const handleCreatePlaylistFromRail = useCallback(async () => {
    if (isCreatingRailPlaylist) {
      return;
    }

    setIsCreatingRailPlaylist(true);
    setPlaylistMutationTone("info");
    setPlaylistMutationMessage(null);

    try {
      const response = await fetchWithAuthRetry("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        }),
      });

      if (response.status === 401 || response.status === 403) {
        void checkAuthState();
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to create playlists.");
        return;
      }

      if (!response.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not create playlist.");
        return;
      }

      const created = (await response.json()) as { id?: string };
      if (!created.id) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist was created but could not be opened.");
        return;
      }

      setPlaylistCreationPendingId(created.id);
      window.dispatchEvent(new Event(PLAYLISTS_UPDATED_EVENT));
      router.replace(getActivatePlaylistHref(created.id));
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Could not create playlist.");
    } finally {
      setIsCreatingRailPlaylist(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAuthState, fetchWithAuthRetry, isCreatingRailPlaylist, router, searchParamsString, currentVideoId]);

  const handleAddToPlaylistFromWatchNext = useCallback(async (track: VideoRecord) => {
    if (playlistMutationPendingVideoId) {
      return;
    }

    setPlaylistMutationPendingVideoId(track.id);
    setPlaylistMutationMessage(null);
    setPlaylistMutationTone("info");

    try {
      const effectivePlaylistId = activePlaylistId ?? pendingCreatedPlaylistIdRef.current;

      if (effectivePlaylistId) {
        const addResponse = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(effectivePlaylistId)}/items`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ videoId: track.id }),
        });

        if (addResponse.status === 401 || addResponse.status === 403) {
          void checkAuthState();
          setPlaylistMutationTone("error");
          setPlaylistMutationMessage("Sign in to save tracks to playlists.");
          return;
        }

        if (!addResponse.ok) {
          setPlaylistMutationTone("error");
          setPlaylistMutationMessage("Could not add track to playlist.");
          return;
        }

        setLastAddedRelatedVideoId(track.id);
        setPlaylistRailData((prev) =>
          prev ? { ...prev, itemCount: Math.max(prev.videos.length, prev.itemCount ?? 0) + 1 } : prev,
        );
        return;
      }

      const createResponse = await fetchWithAuthRetry("/api/playlists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        }),
      });

      if (createResponse.status === 401 || createResponse.status === 403) {
        void checkAuthState();
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to create playlists.");
        return;
      }

      if (!createResponse.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not create playlist.");
        return;
      }

      const created = (await createResponse.json()) as { id?: string };

      if (!created.id) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist was created but could not be opened.");
        return;
      }

      const addResponse = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(created.id)}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: track.id }),
      });

      if (addResponse.status === 401 || addResponse.status === 403) {
        void checkAuthState();
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to save tracks to playlists.");
        return;
      }

      if (!addResponse.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Playlist created, but this track could not be added.");
        return;
      }

      setLastAddedRelatedVideoId(track.id);
      pendingCreatedPlaylistIdRef.current = created.id;
      suppressPlaylistRailAutoSwitchRef.current = true;
      const params = new URLSearchParams(searchParamsString);
      params.set("v", currentVideoId);
      params.set("resume", "1");
      params.set("pl", created.id);
      params.delete("pli");
      router.replace(`/?${params.toString()}`);
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Could not update playlists right now.");
    } finally {
      setPlaylistMutationPendingVideoId(null);
    }
  }, [
    activePlaylistId,
    checkAuthState,
    currentVideoId,
    fetchWithAuthRetry,
    playlistMutationPendingVideoId,
    router,
    searchParamsString,
  ]);

  const handleRemoveTrackFromActivePlaylist = useCallback(async (track: PlaylistRailVideo, playlistItemIndex: number) => {
    if (!activePlaylistId) {
      return;
    }

    const slotKey = track.playlistItemId ?? `${track.id}:${playlistItemIndex}`;

    if (hidingPlaylistTrackKeys.includes(slotKey) || playlistItemMutationPendingKeys.includes(slotKey)) {
      return;
    }

    commitPlaylistTrackRemoval(slotKey, playlistItemIndex);
    setPlaylistItemMutationPendingKeys((previous) => [...previous, slotKey]);

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}/items`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playlistItemId: track.playlistItemId, playlistItemIndex }),
      });

      if (response.status === 401 || response.status === 403) {
        void checkAuthState();
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to edit playlists.");
        return;
      }

      if (!response.ok) {
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Track removed visually, but playlist update failed.");
        return;
      }

      const updatedPlaylist = (await response.json().catch(() => null)) as PlaylistRailPayload | null;

      setPlaylistRailSummaries((previous) =>
        previous.map((summary) =>
          summary.id === activePlaylistId
            ? {
                ...summary,
                itemCount: updatedPlaylist?.videos.length ?? Math.max(0, summary.itemCount - 1),
                leadVideoId: updatedPlaylist?.videos[0]?.id ?? "__placeholder__",
              }
            : summary,
        ),
      );

      if (updatedPlaylist?.id === activePlaylistId && Array.isArray(updatedPlaylist.videos)) {
        setPlaylistRailData(updatedPlaylist);
      }
    } catch {
      setPlaylistMutationTone("error");
      setPlaylistMutationMessage("Track removed visually, but playlist update failed.");
    } finally {
      setPlaylistItemMutationPendingKeys((previous) => previous.filter((candidateKey) => candidateKey !== slotKey));
    }
  }, [
    activePlaylistId,
    checkAuthState,
    commitPlaylistTrackRemoval,
    fetchWithAuthRetry,
    hidingPlaylistTrackKeys,
    playlistItemMutationPendingKeys,
  ]);

  const handleReorderActivePlaylistTrack = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!activePlaylistId || fromIndex === toIndex) {
      return;
    }

    const currentPlaylist = playlistRailData;

    if (!currentPlaylist || !Array.isArray(currentPlaylist.videos)) {
      return;
    }

    if (
      fromIndex < 0
      || toIndex < 0
      || fromIndex >= currentPlaylist.videos.length
      || toIndex >= currentPlaylist.videos.length
    ) {
      return;
    }

    const fromPlaylistItemId = currentPlaylist.videos[fromIndex]?.playlistItemId;
    const toPlaylistItemId = currentPlaylist.videos[toIndex]?.playlistItemId;

    playlistRailMutationVersionRef.current += 1;
    setPlaylistRailData((prev) => {
      if (!prev || !Array.isArray(prev.videos)) return prev;
      if (fromIndex >= prev.videos.length || toIndex >= prev.videos.length) return prev;
      const reorderedVideos = [...prev.videos];
      const [moved] = reorderedVideos.splice(fromIndex, 1);
      if (!moved) return prev;
      reorderedVideos.splice(toIndex, 0, moved);
      return { ...prev, videos: reorderedVideos };
    });

    const seq = ++reorderSeqRef.current;

    try {
      const response = await fetchWithAuthRetry(`/api/playlists/${encodeURIComponent(activePlaylistId)}/items`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromPlaylistItemId,
          toPlaylistItemId,
          fromIndex,
          toIndex,
        }),
      });

      if (seq < reorderSeqRef.current) {
        return;
      }

      if (response.status === 401 || response.status === 403) {
        void checkAuthState();
        setPlaylistRailData(currentPlaylist);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Sign in to edit playlists.");
        return;
      }

      if (!response.ok) {
        setPlaylistRailData(currentPlaylist);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not reorder playlist tracks.");
        return;
      }

      const updatedPlaylist = (await response.json().catch(() => null)) as PlaylistRailPayload | null;

      if (updatedPlaylist?.id === activePlaylistId && Array.isArray(updatedPlaylist.videos)) {
        setPlaylistRailData(updatedPlaylist);
        setPlaylistRailSummaries((previous) =>
          previous.map((summary) =>
            summary.id === activePlaylistId
              ? {
                  ...summary,
                  itemCount: updatedPlaylist.videos.length,
                  leadVideoId: updatedPlaylist.videos[0]?.id ?? "__placeholder__",
                }
              : summary,
          ),
        );
      }
    } catch {
      if (seq >= reorderSeqRef.current) {
        setPlaylistRailData(currentPlaylist);
        setPlaylistMutationTone("error");
        setPlaylistMutationMessage("Could not reorder playlist tracks.");
      }
    }
  }, [activePlaylistId, checkAuthState, fetchWithAuthRetry, playlistRailData]);

  const handleSwitchToWatchNextRail = useCallback(() => {
    setRightRailMode("watch-next");

    if (!activePlaylistId) {
      return;
    }

    const params = new URLSearchParams(searchParamsString);
    params.set("v", currentVideoId);
    params.set("resume", "1");
    params.delete("pl");
    params.delete("pli");

    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }, [activePlaylistId, currentVideoId, router, searchParamsString]);

  const handlePlaylistTrackDragStart = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number) => {
    event.stopPropagation();
    setDraggedPlaylistTrackIndex(index);
    setDragOverPlaylistTrackIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handlePlaylistTrackDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    if (dragOverPlaylistTrackIndex !== index) {
      setDragOverPlaylistTrackIndex(index);
    }
  }, [dragOverPlaylistTrackIndex]);

  const handlePlaylistTrackDrop = useCallback((event: ReactDragEvent<HTMLDivElement>, toIndex: number) => {
    event.preventDefault();
    const fromIndex = draggedPlaylistTrackIndex;
    setDraggedPlaylistTrackIndex(null);
    setDragOverPlaylistTrackIndex(null);

    if (fromIndex === null || fromIndex === toIndex) {
      return;
    }

    void handleReorderActivePlaylistTrack(fromIndex, toIndex);
  }, [draggedPlaylistTrackIndex, handleReorderActivePlaylistTrack]);

  const handlePlaylistTrackDragEnd = useCallback(() => {
    setDraggedPlaylistTrackIndex(null);
    setDragOverPlaylistTrackIndex(null);
  }, []);

  return {
    rightRailMode,
    setRightRailMode,
    playlistRailData,
    isPlaylistRailLoading,
    playlistRailError,
    playlistRailSummaries,
    isPlaylistSummaryLoading,
    playlistSummaryError,
    playlistRefreshTick,
    setPlaylistRefreshTick,
    playlistMutationMessage,
    playlistMutationTone,
    setPlaylistMutationMessage,
    setPlaylistMutationTone,
    playlistMutationPendingVideoId,
    isCreatingRailPlaylist,
    playlistCreationPendingId,
    lastAddedRelatedVideoId,
    recentlyAddedPlaylistTrack,
    hidingPlaylistTrackKeys,
    playlistItemMutationPendingKeys,
    draggedPlaylistTrackIndex,
    dragOverPlaylistTrackIndex,
    isDeletingActivePlaylist,
    showDeleteActivePlaylistConfirm,
    setShowDeleteActivePlaylistConfirm,
    confirmDeleteRailPlaylist,
    setConfirmDeleteRailPlaylist,
    playlistBeingDeletedId,
    playlistStackBodyRef,
    activePlaylistTrackIndex,
    activePlaylistTrackCount,
    isCreatingActivePlaylist,
    getActivatePlaylistHref,
    getClosePlaylistHref,
    handleDeleteActivePlaylist,
    handleDeletePlaylistFromRail,
    handleCreatePlaylistFromRail,
    handleAddToPlaylistFromWatchNext,
    handleRemoveTrackFromActivePlaylist,
    handleReorderActivePlaylistTrack,
    handleSwitchToWatchNextRail,
    handlePlaylistTrackDragStart,
    handlePlaylistTrackDragOver,
    handlePlaylistTrackDrop,
    handlePlaylistTrackDragEnd,
  };
}
