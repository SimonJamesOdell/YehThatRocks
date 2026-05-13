"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { resolvePostDeleteNextVideo } from "@/components/player-experience-share-admin-domain";
import { EVENT_NAMES } from "@/lib/events-contract";
import type { VideoRecord } from "@/lib/catalog";

type SearchParamsLike = {
  get: (name: string) => string | null;
  toString: () => string;
};

export function useAdminDeleteCurrentVideoAction({
  isAdmin,
  isAdminDeleting,
  currentVideoId,
  resolvedNextVideoId,
  playlistQueueIds,
  activePlaylistId,
  effectivePlaylistIndex,
  temporaryQueue,
  queue,
  navigateToVideo,
  setIsAdminDeleting,
  setShowAdminDeleteConfirmModal,
  setShowShareMenu,
  setAdminEditError,
  setAdminEditStatus,
  pauseActivePlayback,
  fetchWithAuthRetry,
  setPlaylistQueueIds,
  showUnavailableOverlayMessage,
  showDeletedOverlayConfirmation,
  searchParams,
  pathname,
  routerReplace,
  isDockedDesktop,
  onDockHideRequest,
  nextPlaylistIndexRef,
  dispatchAppEvent,
}: {
  isAdmin: boolean;
  isAdminDeleting: boolean;
  currentVideoId: string;
  resolvedNextVideoId: string | null;
  playlistQueueIds: string[];
  activePlaylistId: string | null;
  effectivePlaylistIndex: number | null;
  temporaryQueue: VideoRecord[];
  queue: VideoRecord[];
  navigateToVideo: (
    videoId: string,
    options?: {
      clearPlaylist?: boolean;
      playlistId?: string | null;
      playlistItemIndex?: number | null;
    },
  ) => void;
  setIsAdminDeleting: Dispatch<SetStateAction<boolean>>;
  setShowAdminDeleteConfirmModal: Dispatch<SetStateAction<boolean>>;
  setShowShareMenu: Dispatch<SetStateAction<boolean>>;
  setAdminEditError: Dispatch<SetStateAction<string | null>>;
  setAdminEditStatus: Dispatch<SetStateAction<string | null>>;
  pauseActivePlayback: () => void;
  fetchWithAuthRetry: typeof fetch;
  setPlaylistQueueIds: Dispatch<SetStateAction<string[]>>;
  showUnavailableOverlayMessage: (message: string) => void;
  showDeletedOverlayConfirmation: () => void;
  searchParams: SearchParamsLike;
  pathname: string;
  routerReplace: (href: string) => void;
  isDockedDesktop: boolean;
  onDockHideRequest?: (() => void) | null;
  nextPlaylistIndexRef: MutableRefObject<number>;
  dispatchAppEvent: (eventName: string, payload: unknown) => void;
}) {
  const handleAdminDeleteCurrentVideo = useCallback(async () => {
    if (!isAdmin || isAdminDeleting) {
      return;
    }

    const deletingVideoId = currentVideoId;

    const navigateAfterCatalogDelete = (removedVideoId: string) => {
      const { nextId, nextPlaylistIndex } = resolvePostDeleteNextVideo({
        removedVideoId,
        resolvedNextVideoId,
        playlistQueueIds,
        activePlaylistId,
        effectivePlaylistIndex,
        temporaryQueue,
        queue,
      });

      if (!nextId) {
        return false;
      }

      navigateToVideo(nextId, {
        clearPlaylist: nextPlaylistIndex < 0,
        playlistId: nextPlaylistIndex >= 0 ? activePlaylistId : null,
        playlistItemIndex: nextPlaylistIndex >= 0 ? nextPlaylistIndex : null,
      });

      return true;
    };

    setIsAdminDeleting(true);
    setShowAdminDeleteConfirmModal(false);
    setShowShareMenu(false);
    setAdminEditError(null);
    setAdminEditStatus(null);
    pauseActivePlayback();

    try {
      const response = await fetchWithAuthRetry("/api/admin/videos", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoId: deletingVideoId,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null;
        if (response.status === 401 || response.status === 403) {
          showUnavailableOverlayMessage("Admin session expired. Please sign in again.");
          return;
        }
        if (response.status === 404) {
          dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
          dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
          dispatchAppEvent(EVENT_NAMES.VIDEO_CATALOG_DELETED, { videoId: deletingVideoId });
          setPlaylistQueueIds((currentIds) => currentIds.filter((id) => id !== deletingVideoId));

          const advanced = navigateAfterCatalogDelete(deletingVideoId);
          if (!advanced) {
            showDeletedOverlayConfirmation();
          }
          return;
        }
        showUnavailableOverlayMessage(payload?.error || "Could not remove this video from the site.");
        return;
      }

      dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
      dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
      dispatchAppEvent(EVENT_NAMES.VIDEO_CATALOG_DELETED, { videoId: deletingVideoId });
      setPlaylistQueueIds((currentIds) => currentIds.filter((id) => id !== deletingVideoId));

      const clearedParams = new URLSearchParams(searchParams.toString());
      const selectedVideoId = clearedParams.get("v");
      if (selectedVideoId === deletingVideoId) {
        clearedParams.delete("v");
        clearedParams.delete("pl");
        clearedParams.delete("pli");
        const clearedQuery = clearedParams.toString();
        routerReplace(clearedQuery ? `${pathname}?${clearedQuery}` : pathname);
      }

      if (isDockedDesktop) {
        const params = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams(searchParams.toString());
        params.delete("v");
        params.delete("pl");
        params.delete("pli");
        const query = params.toString();
        routerReplace(query ? `${pathname}?${query}` : pathname);
        onDockHideRequest?.();
        dispatchAppEvent(EVENT_NAMES.DOCK_HIDE_REQUEST, null);
        return;
      }

      if (activePlaylistId) {
        const remainingPlaylistIds = playlistQueueIds.filter((id) => id !== deletingVideoId);
        if (remainingPlaylistIds.length > 0) {
          nextPlaylistIndexRef.current = Math.max(0, Math.min(
            effectivePlaylistIndex ?? playlistQueueIds.findIndex((id) => id === deletingVideoId),
            remainingPlaylistIds.length - 1,
          ));
        }
      }

      const advanced = navigateAfterCatalogDelete(deletingVideoId);
      if (!advanced) {
        showDeletedOverlayConfirmation();
      }
    } catch {
      showUnavailableOverlayMessage("Could not remove this video from the site.");
    } finally {
      setIsAdminDeleting(false);
    }
  }, [
    activePlaylistId,
    currentVideoId,
    dispatchAppEvent,
    effectivePlaylistIndex,
    fetchWithAuthRetry,
    isAdmin,
    isAdminDeleting,
    isDockedDesktop,
    navigateToVideo,
    nextPlaylistIndexRef,
    onDockHideRequest,
    pathname,
    pauseActivePlayback,
    playlistQueueIds,
    queue,
    resolvedNextVideoId,
    routerReplace,
    searchParams,
    setAdminEditError,
    setAdminEditStatus,
    setIsAdminDeleting,
    setPlaylistQueueIds,
    setShowAdminDeleteConfirmModal,
    setShowShareMenu,
    showDeletedOverlayConfirmation,
    showUnavailableOverlayMessage,
    temporaryQueue,
  ]);

  return { handleAdminDeleteCurrentVideo };
}
