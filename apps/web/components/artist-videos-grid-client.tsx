"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveSearchParams } from "@/components/use-live-search-params";

import { ArtistVideoLink } from "@/components/artist-video-link";
import { ArtistCreatePlaylistButton } from "@/components/artist-create-playlist-button";
import { ArtistAdminMetadataEditor } from "@/components/artist-admin-metadata-editor";
import { AdminArtistDiscoveryButton } from "@/components/admin-artist-discovery-button";
import { CloseLink } from "@/components/close-link";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { OverlayHeader } from "@/components/overlay-header";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import type { VideoRecord } from "@/lib/catalog";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";

const ARTIST_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-artist";

type ArtistVideosGridClientProps = {
  artistName: string;
  artistSlug: string;
  artistsHref: string;
  initialVideos: VideoRecord[];
  seenVideoIds: string[];
  isAuthenticated: boolean;
  isAdmin: boolean;
};

export function ArtistVideosGridClient({
  artistName,
  artistSlug,
  artistsHref,
  initialVideos,
  seenVideoIds,
  isAuthenticated,
  isAdmin,
}: ArtistVideosGridClientProps) {
  const searchParams = useLiveSearchParams();
  const [videos, setVideos] = useState<VideoRecord[]>(initialVideos);
  const [hidingVideoIds, setHidingVideoIds] = useState<string[]>([]);
  const [videoPendingHideConfirm, setVideoPendingHideConfirm] = useState<VideoRecord | null>(null);
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: ARTIST_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const seenVideoIdSet = useMemo(() => new Set(seenVideoIds), [seenVideoIds]);
  const visibleVideos = useMemo(
    () => (isAuthenticated && hideSeen ? videos.filter((video) => !seenVideoIdSet.has(video.id)) : videos),
    [hideSeen, isAuthenticated, seenVideoIdSet, videos],
  );
  const openedFrom = searchParams.get("from")?.trim() ?? "";
  const sourceRoute = openedFrom === "new"
    ? "/new"
    : openedFrom === "top100"
      ? "/top100"
      : openedFrom === "favourites"
        ? "/favourites"
        : null;
  const wasOpenedFromSourceRoute = sourceRoute !== null;
  const returnToParam = searchParams.get("returnTo")?.trim() ?? "";
  const videoId = searchParams.get("v")?.trim() ?? "";
  const router = useRouter();
  const autoPlayRedirectedRef = useRef(false);

  // When the artist page loads without a specific video, pick the right video
  // to highlight/play. If the user arrived from a page where a video was already
  // playing (carried in the returnTo param), and that video is in this artist's
  // list, keep it — the player stays uninterrupted and the grid just highlights
  // it. Otherwise, auto-play the first track in the grid.
  useEffect(() => {
    if (autoPlayRedirectedRef.current) return;
    if (videoId) return;

    // Check if the returnTo param carries a video that's already playing
    let targetId: string | null = null;
    if (returnToParam) {
      try {
        const returnToQuery = returnToParam.includes("?")
          ? new URLSearchParams(returnToParam.slice(returnToParam.indexOf("?")))
          : null;
        const returnToVideoId = returnToQuery?.get("v")?.trim();
        if (returnToVideoId && visibleVideos.some((v) => v.id === returnToVideoId)) {
          targetId = returnToVideoId;
        }
      } catch {
        // malformed returnTo — fall through to first-video logic
      }
    }

    if (!targetId) {
      const first = visibleVideos[0];
      if (!first?.id) return;
      targetId = first.id;
    }

    autoPlayRedirectedRef.current = true;
    router.replace(`/artist/${encodeURIComponent(artistSlug)}?v=${encodeURIComponent(targetId)}&resume=1`);
  }, [artistSlug, returnToParam, videoId, visibleVideos]);

  const closeToSourceHref = useMemo(() => {
    if (sourceRoute && returnToParam.startsWith(sourceRoute) && !returnToParam.startsWith("//")) {
      return returnToParam;
    }

    if (!sourceRoute) {
      return "/";
    }

    if (videoId) {
      return `${sourceRoute}?v=${encodeURIComponent(videoId)}&resume=1`;
    }

    return sourceRoute;
  }, [returnToParam, sourceRoute, videoId]);

  const handleCloseToSource = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    event.preventDefault();
    dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href: closeToSourceHref });
  }, [closeToSourceHref]);

  const handleHideVideo = useCallback((video: VideoRecord) => {
    if (!isAuthenticated || hidingVideoIds.includes(video.id)) {
      return;
    }

    setVideoPendingHideConfirm(video);
  }, [hidingVideoIds, isAuthenticated]);

  const confirmHideVideo = useCallback(async () => {
    const video = videoPendingHideConfirm;

    if (!video || !isAuthenticated || hidingVideoIds.includes(video.id)) {
      return;
    }

    setVideoPendingHideConfirm(null);

    await mutateHiddenVideo({
      action: "hide",
      videoId: video.id,
      onOptimisticUpdate: () => {
        setHidingVideoIds((current) => [...current, video.id]);
        setVideos((current) => current.filter((candidate) => candidate.id !== video.id));
      },
      onSettled: () => {
        setHidingVideoIds((current) => current.filter((id) => id !== video.id));
      },
    });
  }, [hidingVideoIds, isAuthenticated, videoPendingHideConfirm]);

  return (
    <>
      <OverlayHeader close={false}>
        <div className="newPageHeaderLeft">
          <strong>
            <span className="categoryHeaderBreadcrumb" aria-label="Breadcrumb">
              <span className="categoryHeaderIcon" aria-hidden="true">🎸</span>
              <Link href={artistsHref} className="categoryHeaderBreadcrumbLink">
                Artists
              </Link>
              <span className="categoryHeaderBreadcrumbSeparator" aria-hidden="true">&gt;</span>
              <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{artistName} ({visibleVideos.length})</span>
            </span>
          </strong>
          {isAuthenticated ? (
            <button
              type="button"
              className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
              onClick={() => setHideSeen((value) => !value)}
              aria-pressed={hideSeen}
            >
              {hideSeen ? "Showing unseen only" : "Show unseen only"}
            </button>
          ) : null}
          <ArtistCreatePlaylistButton
            isAuthenticated={isAuthenticated}
            artistName={artistName}
            videos={visibleVideos}
            hideSeenOnly={hideSeen}
          />
          <ArtistAdminMetadataEditor
            isAdmin={isAdmin}
            videos={videos}
            onVideoPatched={(videoId, patch) => {
              setVideos((current) => current.map((video) => (
                video.id === videoId
                  ? { ...video, ...patch }
                  : video
              )));
            }}
          />
          <AdminArtistDiscoveryButton artistName={artistName} isAdmin={isAdmin} />
        </div>
        {wasOpenedFromSourceRoute ? (
          <Link
            href={closeToSourceHref}
            className="favouritesBlindClose"
            data-overlay-close="true"
            onClick={handleCloseToSource}
          >
            Close
          </Link>
        ) : (
          <CloseLink />
        )}
      </OverlayHeader>

      <div className="categoryVideoGrid artistVideoGrid">
        {visibleVideos.map((video) => (
          <ArtistVideoLink
            key={video.id}
            video={video}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            isSeen={seenVideoIdSet.has(video.id)}
            isActive={video.id === videoId}
            useCornerActions
            adminThumbnailArtistSlug={artistSlug}
            adminThumbnailArtistName={artistName}
            navigatePathname={`/artist/${artistSlug}`}
            onHideVideo={handleHideVideo}
            isHidePending={hidingVideoIds.includes(video.id)}
          />
        ))}
      </div>

      <HideVideoConfirmModal
        isOpen={videoPendingHideConfirm !== null}
        video={videoPendingHideConfirm}
        isPending={videoPendingHideConfirm ? hidingVideoIds.includes(videoPendingHideConfirm.id) : false}
        onCancel={() => setVideoPendingHideConfirm(null)}
        onConfirm={() => {
          void confirmHideVideo();
        }}
      />
    </>
  );
}