"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef } from "react";

import { AddToPlaylistButton } from "@/components/add-to-playlist-button";
import type { VideoRecord } from "@/lib/catalog";

const PENDING_VIDEO_SELECTION_KEY = "ytr:pending-video-selection";

type ArtistVideoLinkProps = {
  video: VideoRecord;
  isAuthenticated?: boolean;
  isSeen?: boolean;
  useCornerActions?: boolean;
  onHideVideo?: (video: VideoRecord) => void;
  isHidePending?: boolean;
};

export function ArtistVideoLink({
  video,
  isAuthenticated = true,
  isSeen = false,
  useCornerActions = false,
  onHideVideo,
  isHidePending = false,
}: ArtistVideoLinkProps) {
  const hasWarmedRef = useRef(false);

  const warmSelection = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(
        PENDING_VIDEO_SELECTION_KEY,
        JSON.stringify({
          id: video.id,
          title: video.title,
          channelTitle: video.channelTitle,
          genre: video.genre,
          favourited: video.favourited,
          description: video.description,
        }),
      );
    }

    if (hasWarmedRef.current) {
      return;
    }

    hasWarmedRef.current = true;
    void fetch(`/api/current-video?v=${encodeURIComponent(video.id)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }, [video]);

  return (
    <article className={`categoryVideoCard${isSeen ? " categoryVideoCardSeen artistVideoCardSeen" : ""}${useCornerActions ? " categoryVideoCardCornerActions" : ""}`}>
      {isAuthenticated && useCornerActions && onHideVideo ? (
        <button
          type="button"
          className="categoryVideoHideButton"
          aria-label={`Hide ${video.title} from this category`}
          title="Hide from this category"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onHideVideo(video);
          }}
          disabled={isHidePending}
        >
          x
        </button>
      ) : null}
      <Link
        href={`/?v=${video.id}&resume=1`}
        className="linkedCard categoryVideoPrimaryLink"
        onMouseEnter={warmSelection}
        onFocus={warmSelection}
        onPointerDown={warmSelection}
        onClick={warmSelection}
      >
        <div className="categoryThumbWrap">
          <Image
            src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
            alt=""
            width={320}
            height={180}
            className="categoryThumb"
            loading="lazy"
          />
          {isSeen ? <span className="videoSeenBadge videoSeenBadgeOverlay categorySeenBadgeOverlay">Seen</span> : null}
        </div>
        <h3 className="categoryVideoTitle">{video.title}</h3>
      </Link>
      <div className="actionRow categoryVideoActions">
        <AddToPlaylistButton
          videoId={video.id}
          isAuthenticated={isAuthenticated}
          compact={useCornerActions}
          className={useCornerActions ? "categoryVideoPlaylistAddButton" : undefined}
        />
      </div>
    </article>
  );
}