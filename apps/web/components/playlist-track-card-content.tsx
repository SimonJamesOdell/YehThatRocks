"use client";

import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";

import { fetchArtistVideoCountForCard } from "@/components/artist-video-count";
import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";
import { getArtistPagePath } from "@/lib/artist-routing";

type PlaylistTrack = {
  id: string;
  title: string;
  channelTitle: string;
  parsedArtist?: string | null;
  parsedTrack?: string | null;
};

type PlaylistTrackCardContentProps = {
  track: PlaylistTrack;
  index: number;
};

export function PlaylistTrackCardContent({
  track,
  index,
}: PlaylistTrackCardContentProps) {
  const router = useRouter();
  const [artistVideoCount, setArtistVideoCount] = useState<number | null>(null);
  const parsedArtistCandidate = track.parsedArtist?.trim() || track.channelTitle?.trim() || "";
  const parsedTrackCandidate = track.parsedTrack?.trim() || "";
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
          loading={index < 3 ? "eager" : "lazy"}
          fetchPriority={index < 2 ? "high" : "auto"}
          className="relatedThumb"
          reportReason="thumbnail-load-error:playlist-track"
          hideClosestSelector=".relatedCardSlot"
        />
      </div>
      <div>
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
