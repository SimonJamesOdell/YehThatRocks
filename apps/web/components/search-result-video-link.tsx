"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { VideoGenreLink } from "@/components/video-genre-link";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { navigateVideoHref } from "@/components/player-video-navigation";
import { PENDING_VIDEO_SELECTION_KEY } from "@/lib/storage-keys";

type SearchResultVideoLinkProps = {
  video: {
    id: string;
    title: string;
    channelTitle: string;
    genre?: string | null;
    favourited?: number;
    description?: string | null;
  };
  displayTitle: string;
  isSeen: boolean;
};

export function SearchResultVideoLink({ video, displayTitle, isSeen }: SearchResultVideoLinkProps) {
  const router = useRouter();
  const hasWarmedRef = useRef(false);
  const videoHref = `/?v=${encodeURIComponent(video.id)}&resume=1`;

  const stagePendingSelection = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      PENDING_VIDEO_SELECTION_KEY,
      JSON.stringify({
        id: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        genre: video.genre ?? null,
        favourited: video.favourited ?? 0,
        description: video.description ?? "",
      }),
    );
  }, [video.channelTitle, video.description, video.favourited, video.genre, video.id, video.title]);

  const warmSelection = useCallback(() => {
    stagePendingSelection();

    if (hasWarmedRef.current) {
      return;
    }

    hasWarmedRef.current = true;
    void fetch(`/api/current-video?v=${encodeURIComponent(video.id)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }, [stagePendingSelection, video.id]);

  const handleOpenVideo = useCallback(() => {
    warmSelection();
    dispatchAppEvent(EVENT_NAMES.MANUAL_VIDEO_NAVIGATION_REQUEST, { videoId: video.id });

    if (typeof window !== "undefined") {
      const selectedVideoId = new URLSearchParams(window.location.search).get("v");
      if (selectedVideoId !== video.id) {
        navigateVideoHref({
          href: videoHref,
          useNativeHistory: true,
          routerPush: (href) => {
            router.push(href, { scroll: false });
          },
        });
      }
    }
  }, [router, video.id, videoHref, warmSelection]);

  return (
    <Link
      href={videoHref}
      className="linkedCard leaderboardTrackLink"
      prefetch={false}
      onPointerDown={warmSelection}
      onMouseEnter={warmSelection}
      onFocus={warmSelection}
      onClick={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        const isPrimaryButton = event.button === 0 || event.button === undefined;
        if (!isPrimaryButton || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();
        handleOpenVideo();
      }}
    >
      <div className="leaderboardThumbWrap" data-video-id={video.id}>
        <YouTubeThumbnailImage
          videoId={video.id}
          alt=""
          className="leaderboardThumb"
          loading="lazy"
          reportReason="thumbnail-load-error:search"
        />
        {isSeen ? <span className="videoSeenBadge videoSeenBadgeOverlay">Seen</span> : null}
      </div>
      <div className="leaderboardMeta">
        <h3>{displayTitle}</h3>
        <p className="leaderboardVideoCategory">
          <VideoGenreLink genre={video.genre ?? "Rock / Metal"} stopPropagation nestedInLink />
        </p>
        <p>
          <ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">
            {video.channelTitle}
          </ArtistWikiLink>
        </p>
      </div>
    </Link>
  );
}
