"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { VideoGenreLink } from "@/components/video-genre-link";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
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
  isSeen: boolean;
};

import { inferTrackFromTitle } from "@/lib/infer-track-title";

export function SearchResultVideoLink({ video, isSeen }: SearchResultVideoLinkProps) {
  const router = useRouter();
  const hasWarmedRef = useRef(false);
  const videoHref = `/?v=${encodeURIComponent(video.id)}&resume=1`;

  const [isFavourited, setIsFavourited] = useState(Number(video.favourited ?? 0) > 0);
  const [isRemovingFavourite, setIsRemovingFavourite] = useState(false);

  useEffect(() => {
    setIsFavourited(Number(video.favourited ?? 0) > 0);
  }, [video.id, video.favourited]);

  const rawDisplayTitle = video.title;
  const parsedArtistCandidate =
    video.channelTitle?.trim()
    || inferArtistFromTitle(rawDisplayTitle)?.trim()
    || "";
  const metadataArtist = parsedArtistCandidate || "Unknown Artist";
  const parsedTrackCandidate = inferTrackFromTitle(rawDisplayTitle, metadataArtist);
  const parsedArtistLabel = parsedArtistCandidate.toUpperCase();
  const displayTitle = parsedArtistCandidate && parsedTrackCandidate
    ? `${parsedArtistLabel} - ${parsedTrackCandidate}`
    : rawDisplayTitle;
  const categoryLabel = (video.genre ?? "Rock / Metal").trim();
  const showCategoryLabel = categoryLabel.length > 0;

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

  const handleRemoveFavourite = useCallback(async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (isRemovingFavourite) {
      return;
    }

    setIsRemovingFavourite(true);

    try {
      const response = await fetchWithAuthRetry("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id, action: "remove" }),
      });

      if (!response.ok) {
        return;
      }

      setIsFavourited(false);
      dispatchAppEvent(EVENT_NAMES.FAVOURITES_UPDATED, null);
    } finally {
      setIsRemovingFavourite(false);
    }
  }, [isRemovingFavourite, video.id]);

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
        {isSeen && !isFavourited ? <span className="videoSeenBadge videoSeenBadgeOverlay">Seen</span> : null}
        {isFavourited ? (
          <button
            type="button"
            className="relatedFavouriteBadgeOverlay top100FavouriteBadgeOverlay artistVideoFavouriteBadgeButton"
            aria-label={`Remove ${video.title} from favourites`}
            title="Remove from favourites"
            disabled={isRemovingFavourite}
            onClick={handleRemoveFavourite}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <span className="artistVideoFavouriteBadgeHeart" aria-hidden="true">♥</span>
            <span className="artistVideoFavouriteBadgeRemoveGlyph" aria-hidden="true">x</span>
          </button>
        ) : null}
      </div>
      <div className="leaderboardMeta">
        {showCategoryLabel ? (
          <p className="leaderboardVideoCategory">
            <VideoGenreLink genre={categoryLabel} stopPropagation nestedInLink />
          </p>
        ) : null}
        <h3>
          {parsedArtistCandidate && parsedTrackCandidate ? (
            <>
              <ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">
                {parsedArtistLabel}
              </ArtistWikiLink>
              <span aria-hidden="true"> - </span>
              <span>{parsedTrackCandidate}</span>
            </>
          ) : (
            displayTitle
          )}
        </h3>
      </div>
    </Link>
  );
}
