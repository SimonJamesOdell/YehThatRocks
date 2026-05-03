"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ArtistVideoLink } from "@/components/artist-video-link";
import { ArtistCreatePlaylistButton } from "@/components/artist-create-playlist-button";
import { CloseLink } from "@/components/close-link";
import { HideVideoConfirmModal } from "@/components/hide-video-confirm-modal";
import { OverlayHeader } from "@/components/overlay-header";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import type { VideoRecord } from "@/lib/catalog";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";

const ARTIST_HIDE_SEEN_TOGGLE_KEY = "ytr-toggle-hide-seen-artist";

type ArtistVideosGridClientProps = {
  artistName: string;
  artistsHref: string;
  initialVideos: VideoRecord[];
  seenVideoIds: string[];
  isAuthenticated: boolean;
};

export function ArtistVideosGridClient({
  artistName,
  artistsHref,
  initialVideos,
  seenVideoIds,
  isAuthenticated,
}: ArtistVideosGridClientProps) {
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
              <span className="categoryHeaderBreadcrumbCurrent" aria-current="page">{artistName}</span>
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
        </div>
        <CloseLink />
      </OverlayHeader>

      <div className="categoryVideoGrid artistVideoGrid">
        {visibleVideos.map((video) => (
          <ArtistVideoLink
            key={video.id}
            video={video}
            isAuthenticated={isAuthenticated}
            isSeen={seenVideoIdSet.has(video.id)}
            useCornerActions
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
