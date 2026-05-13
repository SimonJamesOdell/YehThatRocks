"use client";

import { useCallback } from "react";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { addPlaylistItemClient, createPlaylistClient, listPlaylistsClient } from "@/lib/playlist-client-service";
import { LAST_PLAYLIST_ID_KEY } from "@/lib/storage-keys";

type PlaylistSummary = {
  id: string;
  name: string;
  itemCount?: number;
};

export function usePlayerFooterPlaylistActions({
  isLoggedIn,
  footerPlaylistAddState,
  showFooterPlaylistMenu,
  footerOpenAfterSelect,
  currentVideoId,
  activePlaylistId,
  pathname,
  searchParamsString,
  setShowFooterPlaylistMenu,
  setFooterShowExistingList,
  setFooterPlaylistAddState,
  setFooterPlaylistMenuLoading,
  setFooterPlaylistMenuPlaylists,
  triggerPlaylistDropAnimation,
  buildGeneratedPlaylistName,
  replaceRoute,
}: {
  isLoggedIn: boolean;
  footerPlaylistAddState: "idle" | "saving" | "added" | "error";
  showFooterPlaylistMenu: boolean;
  footerOpenAfterSelect: boolean;
  currentVideoId: string;
  activePlaylistId: string | null;
  pathname: string;
  searchParamsString: string;
  setShowFooterPlaylistMenu: (value: boolean) => void;
  setFooterShowExistingList: (value: boolean) => void;
  setFooterPlaylistAddState: (value: "idle" | "saving" | "added" | "error" | ((current: "idle" | "saving" | "added" | "error") => "idle" | "saving" | "added" | "error")) => void;
  setFooterPlaylistMenuLoading: (value: boolean) => void;
  setFooterPlaylistMenuPlaylists: (value: PlaylistSummary[]) => void;
  triggerPlaylistDropAnimation: () => void;
  buildGeneratedPlaylistName: () => string;
  replaceRoute: (href: string) => void;
}) {
  const addCurrentTrackToPlaylist = useCallback(async (playlistId: string) => {
    const addResponse = await addPlaylistItemClient(
      { playlistId, videoId: currentVideoId },
      { telemetryContext: { component: "player-experience-core", mode: "add-current-track" } },
    );

    if (!addResponse.ok) {
      return false;
    }

    dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null);
    return true;
  }, [currentVideoId]);

  const loadFooterPlaylistMenu = useCallback(async () => {
    setFooterPlaylistMenuLoading(true);

    try {
      const response = await listPlaylistsClient({
        telemetryContext: {
          component: "player-experience-core",
          mode: "footer-menu-list",
        },
      });

      if (!response.ok) {
        setFooterPlaylistMenuPlaylists([]);
        return;
      }

      setFooterPlaylistMenuPlaylists(response.data as PlaylistSummary[]);
    } catch {
      setFooterPlaylistMenuPlaylists([]);
    } finally {
      setFooterPlaylistMenuLoading(false);
    }
  }, [setFooterPlaylistMenuLoading, setFooterPlaylistMenuPlaylists]);

  const markFooterPlaylistAdded = useCallback(() => {
    setFooterPlaylistAddState("added");
    window.setTimeout(() => {
      setFooterPlaylistAddState((current) => (current === "added" ? "idle" : current));
    }, 1800);
  }, [setFooterPlaylistAddState]);

  const markFooterPlaylistError = useCallback(() => {
    setFooterPlaylistAddState("error");
    window.setTimeout(() => {
      setFooterPlaylistAddState((current) => (current === "error" ? "idle" : current));
    }, 2200);
  }, [setFooterPlaylistAddState]);

  const openPlaylistInRoute = useCallback((playlistId: string) => {
    const params = new URLSearchParams(searchParamsString);
    params.set("v", currentVideoId);
    params.set("resume", "1");
    params.set("pl", playlistId);
    params.delete("pli");
    replaceRoute(`${pathname}?${params.toString()}`);
  }, [currentVideoId, pathname, replaceRoute, searchParamsString]);

  const handleFooterPlaylistButtonClick = useCallback(async () => {
    if (!isLoggedIn || footerPlaylistAddState === "saving") {
      return;
    }

    const shouldOpen = !showFooterPlaylistMenu;
    setShowFooterPlaylistMenu(shouldOpen);
    if (!shouldOpen) {
      setFooterShowExistingList(false);
    }
  }, [footerPlaylistAddState, isLoggedIn, setFooterShowExistingList, setShowFooterPlaylistMenu, showFooterPlaylistMenu]);

  const handleFooterPlaylistSelect = useCallback(async (playlistId: string) => {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setShowFooterPlaylistMenu(false);
    setFooterShowExistingList(false);
    setFooterPlaylistAddState("saving");
    triggerPlaylistDropAnimation();

    dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
      mode: "playlist",
      playlistId,
      trackId: currentVideoId,
    });

    try {
      const ok = await addCurrentTrackToPlaylist(playlistId);
      if (ok) {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, playlistId);
        }
        markFooterPlaylistAdded();

        if (footerOpenAfterSelect) {
          openPlaylistInRoute(playlistId);
        }
        return;
      }
      markFooterPlaylistError();
    } catch {
      markFooterPlaylistError();
    }
  }, [
    addCurrentTrackToPlaylist,
    currentVideoId,
    footerOpenAfterSelect,
    footerPlaylistAddState,
    markFooterPlaylistAdded,
    markFooterPlaylistError,
    openPlaylistInRoute,
    setFooterPlaylistAddState,
    setFooterShowExistingList,
    setShowFooterPlaylistMenu,
    triggerPlaylistDropAnimation,
  ]);

  const handleFooterCreatePlaylistNoOpen = useCallback(async () => {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setShowFooterPlaylistMenu(false);
    setFooterShowExistingList(false);
    setFooterPlaylistAddState("saving");
    triggerPlaylistDropAnimation();

    try {
      const createResponse = await createPlaylistClient(
        { name: buildGeneratedPlaylistName(), videoIds: [] },
        { telemetryContext: { component: "player-experience-core", mode: "footer-create-no-open" } },
      );

      if (!createResponse.ok) {
        markFooterPlaylistError();
        return;
      }

      const created = createResponse.data as { id?: string };
      if (!created?.id) {
        markFooterPlaylistError();
        return;
      }

      dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
        mode: "playlist",
        playlistId: created.id,
        trackId: currentVideoId,
      });

      const added = await addCurrentTrackToPlaylist(created.id);
      if (!added) {
        markFooterPlaylistError();
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
      }

      markFooterPlaylistAdded();
    } catch {
      markFooterPlaylistError();
    }
  }, [
    addCurrentTrackToPlaylist,
    buildGeneratedPlaylistName,
    currentVideoId,
    footerPlaylistAddState,
    markFooterPlaylistAdded,
    markFooterPlaylistError,
    setFooterPlaylistAddState,
    setFooterShowExistingList,
    setShowFooterPlaylistMenu,
    triggerPlaylistDropAnimation,
  ]);

  const handleFooterCreatePlaylist = useCallback(async () => {
    if (footerPlaylistAddState === "saving") {
      return;
    }

    setShowFooterPlaylistMenu(false);
    setFooterShowExistingList(false);
    setFooterPlaylistAddState("saving");
    triggerPlaylistDropAnimation();

    try {
      const createResponse = await createPlaylistClient(
        {
          name: buildGeneratedPlaylistName(),
          videoIds: [],
        },
        { telemetryContext: { component: "player-experience-core", mode: "footer-create-open" } },
      );

      if (!createResponse.ok) {
        markFooterPlaylistError();
        return;
      }

      const created = createResponse.data as { id?: string };
      if (!created?.id) {
        markFooterPlaylistError();
        return;
      }

      dispatchAppEvent(EVENT_NAMES.RIGHT_RAIL_MODE, {
        mode: "playlist",
        playlistId: created.id,
        trackId: currentVideoId,
      });

      const added = await addCurrentTrackToPlaylist(created.id);
      if (!added) {
        markFooterPlaylistError();
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_PLAYLIST_ID_KEY, created.id);
      }

      markFooterPlaylistAdded();
      openPlaylistInRoute(created.id);
    } catch {
      markFooterPlaylistError();
    }
  }, [
    addCurrentTrackToPlaylist,
    buildGeneratedPlaylistName,
    currentVideoId,
    footerPlaylistAddState,
    markFooterPlaylistAdded,
    markFooterPlaylistError,
    openPlaylistInRoute,
    setFooterPlaylistAddState,
    setFooterShowExistingList,
    setShowFooterPlaylistMenu,
    triggerPlaylistDropAnimation,
  ]);

  return {
    loadFooterPlaylistMenu,
    handleFooterPlaylistButtonClick,
    handleFooterPlaylistSelect,
    handleFooterCreatePlaylistNoOpen,
    handleFooterCreatePlaylist,
  };
}
