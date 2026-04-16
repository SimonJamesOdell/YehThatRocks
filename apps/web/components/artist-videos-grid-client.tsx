"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ArtistVideoLink } from "@/components/artist-video-link";
import { ArtistCreatePlaylistButton } from "@/components/artist-create-playlist-button";
import { CloseLink } from "@/components/close-link";
import { useSeenTogglePreference } from "@/components/use-seen-toggle-preference";
import type { VideoRecord } from "@/lib/catalog";

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
  const [hideSeen, setHideSeen] = useSeenTogglePreference({
    key: ARTIST_HIDE_SEEN_TOGGLE_KEY,
    isAuthenticated,
  });
  const seenVideoIdSet = useMemo(() => new Set(seenVideoIds), [seenVideoIds]);
  const visibleVideos = useMemo(
    () => (hideSeen ? videos.filter((video) => !seenVideoIdSet.has(video.id)) : videos),
    [hideSeen, seenVideoIdSet, videos],
  );

  const handleHideVideo = useCallback(async (video: VideoRecord) => {
    if (!isAuthenticated || hidingVideoIds.includes(video.id)) {
      return;
    }

    setHidingVideoIds((current) => [...current, video.id]);
    setVideos((current) => current.filter((candidate) => candidate.id !== video.id));

    try {
      await fetch("/api/hidden-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: video.id }),
      });
    } catch {
      // Keep card hidden even if persistence fails, matching quick-hide behavior elsewhere.
    } finally {
      setHidingVideoIds((current) => current.filter((id) => id !== video.id));
    }
  }, [hidingVideoIds, isAuthenticated]);

  return (
    <>
      <div className="favouritesBlindBar">
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
          <button
            type="button"
            className={`newPageSeenToggle${hideSeen ? " newPageSeenToggleActive" : ""}`}
            onClick={() => setHideSeen((value) => !value)}
            aria-pressed={hideSeen}
          >
            {hideSeen ? "Showing unseen only" : "Show unseen only"}
          </button>
          <ArtistCreatePlaylistButton
            isAuthenticated={isAuthenticated}
            artistName={artistName}
            videos={visibleVideos}
            hideSeenOnly={hideSeen}
          />
        </div>
        <CloseLink />
      </div>

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
    </>
  );
}
