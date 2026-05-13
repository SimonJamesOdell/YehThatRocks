import { buildPathWithParams, clearVideoAndPlaylistParams } from "@/components/player-search-params";

export function dispatchDockHideRequest(onDockHideRequest?: () => void) {
  onDockHideRequest?.();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ytr:dock-hide-request"));
  }
}

export function replaceDeletedSelectionIfSelected({
  deletingVideoId,
  pathname,
  searchParams,
  replacePath,
}: {
  deletingVideoId: string;
  pathname: string;
  searchParams: URLSearchParams;
  replacePath: (nextPath: string) => void;
}) {
  const selectedVideoId = searchParams.get("v");
  if (selectedVideoId !== deletingVideoId) {
    return;
  }

  replacePath(buildPathWithParams(pathname, clearVideoAndPlaylistParams(searchParams)));
}

export function handleDockedDeleteClose({
  isDockedDesktop,
  pathname,
  searchParams,
  replacePath,
  onDockHideRequest,
}: {
  isDockedDesktop: boolean;
  pathname: string;
  searchParams: URLSearchParams;
  replacePath: (nextPath: string) => void;
  onDockHideRequest?: () => void;
}) {
  if (!isDockedDesktop) {
    return false;
  }

  replacePath(buildPathWithParams(pathname, clearVideoAndPlaylistParams(searchParams)));
  dispatchDockHideRequest(onDockHideRequest);
  return true;
}

export function applyCatalogDeleteSideEffects({
  deletingVideoId,
  playlistsUpdatedEvent,
  favouritesUpdatedEvent,
  videoCatalogDeletedEvent,
  dispatchEvent,
  setPlaylistQueueIds,
}: {
  deletingVideoId: string;
  playlistsUpdatedEvent: string;
  favouritesUpdatedEvent: string;
  videoCatalogDeletedEvent: string;
  dispatchEvent: (eventName: string, payload: unknown) => void;
  setPlaylistQueueIds: (updater: (currentIds: string[]) => string[]) => void;
}) {
  dispatchEvent(playlistsUpdatedEvent, null);
  dispatchEvent(favouritesUpdatedEvent, null);
  dispatchEvent(videoCatalogDeletedEvent, { videoId: deletingVideoId });
  setPlaylistQueueIds((currentIds) => currentIds.filter((id) => id !== deletingVideoId));
}

export function advanceOrShowDeletedOverlay({
  deletingVideoId,
  navigateAfterCatalogDelete,
  showDeletedOverlayConfirmation,
}: {
  deletingVideoId: string;
  navigateAfterCatalogDelete: (removedVideoId: string) => boolean;
  showDeletedOverlayConfirmation: () => void;
}) {
  const advanced = navigateAfterCatalogDelete(deletingVideoId);
  if (!advanced) {
    showDeletedOverlayConfirmation();
  }
}
