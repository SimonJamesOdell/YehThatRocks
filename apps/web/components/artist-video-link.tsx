"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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

  const openVideoFromCard = useCallback(() => {
    warmSelection();
    router.push(`/?v=${encodeURIComponent(video.id)}&resume=1`);
  }, [router, video.id, warmSelection]);

  return (
    <article
      className={`categoryVideoCard${isSeen ? " categoryVideoCardSeen artistVideoCardSeen" : ""}${useCornerActions ? " categoryVideoCardCornerActions" : ""}`}
      role="link"
      tabIndex={0}
      aria-label={`Play ${video.title}`}
      onClick={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        const target = event.target;
        if (target instanceof Element && target.closest("a")) {
          return;
        }

        openVideoFromCard();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        openVideoFromCard();
      }}
    >
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
        prefetch={false}
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
            sizes="(max-width: 768px) 92vw, (max-width: 1200px) 44vw, 320px"
          />
          {isSeen ? <span className="videoSeenBadge videoSeenBadgeOverlay categorySeenBadgeOverlay">Seen</span> : null}
        </div>
        <h3 className="categoryVideoTitle">{video.title}</h3>
      </Link>
      <div className="actionRow categoryVideoActions">
        <div
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <AddToPlaylistButton
            videoId={video.id}
            isAuthenticated={isAuthenticated}
            compact={useCornerActions}
            className={useCornerActions ? "categoryVideoPlaylistAddButton" : undefined}
          />
        </div>
      </div>
    </article>
  );
}