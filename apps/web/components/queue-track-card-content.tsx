"use client";

import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";

import { fetchArtistVideoCountForCard } from "@/components/artist-video-count";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { getArtistPagePath } from "@/lib/artist-routing";

type QueueTrack = {
  id: string;
  title: string;
  channelTitle: string;
  parsedArtist?: string | null;
  parsedTrack?: string | null;
  genre?: string | null;
  isFavouriteSource?: boolean;
  isTop100Source?: boolean;
  isNewSource?: boolean;
};

type QueueTrackCardContentProps = {
  track: QueueTrack;
  index: number;
};

export function QueueTrackCardContent({ track, index }: QueueTrackCardContentProps) {
  const router = useRouter();
  const [artistVideoCount, setArtistVideoCount] = useState<number | null>(null);
  const parsedArtistCandidate = track.parsedArtist?.trim() || track.channelTitle?.trim() || "";
  const parsedTrackCandidate = (() => {
    const explicitTrack = track.parsedTrack?.trim();
    if (explicitTrack) {
      return explicitTrack;
    }

    const normalizedTitle = track.title?.trim() || "";
    const normalizedArtist = parsedArtistCandidate.trim();
    if (!normalizedTitle || !normalizedArtist) {
      return normalizedTitle;
    }

    const lowerTitle = normalizedTitle.toLowerCase();
    const lowerArtist = normalizedArtist.toLowerCase();
    if (lowerTitle.startsWith(lowerArtist)) {
      const remainder = normalizedTitle.slice(normalizedArtist.length).trimStart();
      const strippedRemainder = remainder.replace(/^[\-:\u2013\u2014\|]+\s*/, "").trim();
      if (strippedRemainder) {
        return strippedRemainder;
      }
    }

    return normalizedTitle;
  })();
  const parsedArtistLabel = parsedArtistCandidate.toUpperCase();
  const parsedTrackLabel = parsedTrackCandidate
    ? `${parsedTrackCandidate.charAt(0).toUpperCase()}${parsedTrackCandidate.slice(1)}`
    : "";
  const hasParsedTitlePattern = Boolean(parsedArtistCandidate && parsedTrackLabel);
  const parsedArtistPagePath = parsedArtistCandidate ? getArtistPagePath(parsedArtistCandidate) : null;
  const artistSlug = parsedArtistPagePath?.split("/")[2] ?? null;
  const artistVideoCountLabel = artistVideoCount === null
    ? null
    : `${artistVideoCount.toLocaleString("en-US")} videos`;
  const genreLabel = track.genre?.trim() || "Rock / Metal";

  useEffect(() => {
    if (!artistSlug) {
      setArtistVideoCount(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const count = await fetchArtistVideoCountForCard(artistSlug, track.id);
      if (!cancelled) {
        setArtistVideoCount(count);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artistSlug, track.id]);

  const handleOpenParsedArtistPage = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router]);

  const handleOpenParsedArtistPageByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!parsedArtistPagePath) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    router.push(parsedArtistPagePath);
  }, [parsedArtistPagePath, router]);

  return (
    <>
      <div className="thumbGlow">
        <YouTubeThumbnailImage
          videoId={track.id}
          alt={track.title}
          className="relatedThumb"
          loading={index < 3 ? "eager" : "lazy"}
          fetchPriority={index < 2 ? "high" : "auto"}
          reportReason="thumbnail-load-error:watch-next-queue"
          hideClosestSelector=".relatedCardSlot"
        />
      </div>
      <div>
        <div className="relatedCardSourceBadges">
          {track.isFavouriteSource ? <span className="relatedSourceBadge relatedSourceBadgeFavourite">Favourite</span> : null}
          {track.isTop100Source ? <span className="relatedSourceBadge relatedSourceBadgeTop100">Top100</span> : null}
          {track.isNewSource ? <span className="relatedSourceBadge relatedSourceBadgeNew">New</span> : null}
        </div>
        <p className="relatedCardGenre">{genreLabel}</p>
        <h3>
          {hasParsedTitlePattern ? (
            <>
              <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
                <span
                  role={parsedArtistPagePath ? "link" : undefined}
                  tabIndex={parsedArtistPagePath ? 0 : undefined}
                  onClick={handleOpenParsedArtistPage}
                  onKeyDown={handleOpenParsedArtistPageByKeyboard}
                >
                  {parsedArtistLabel}
                </span>
              </ArtistWikiLink>
              <span aria-hidden="true"> - </span>
              <span>{parsedTrackLabel}</span>
            </>
          ) : track.title}
        </h3>
        {!hasParsedTitlePattern ? (
          <p>
            <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
              {track.channelTitle}
            </ArtistWikiLink>
          </p>
        ) : null}
        {artistVideoCountLabel ? <p className="leaderboardArtistVideoCount">{artistVideoCountLabel}</p> : null}
      </div>
    </>
  );
}
