"use client";

import Link from "next/link";
import { useMobilePlayer, type MobileVideo } from "@/components/mobile/mobile-player-context";
import { MobileFavouriteButton } from "@/components/mobile/mobile-favourite-button";
import { getArtistPagePath } from "@/lib/artist-routing";

type MobileVideoCardProps = {
  video: MobileVideo;
  initialFavourited?: boolean;
};

export function MobileVideoCard({ video, initialFavourited }: MobileVideoCardProps) {
  const { playVideo, auth } = useMobilePlayer();

  const thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`;
  const parsedArtistCandidate = video.parsedArtist?.trim() || video.channelTitle?.trim() || "";
  const parsedTrackCandidate = video.parsedTrack?.trim() || "";
  const hasParsedTitlePattern = Boolean(parsedArtistCandidate && parsedTrackCandidate);
  const parsedArtistLabel = parsedArtistCandidate.toUpperCase();
  const parsedArtistPagePath = parsedArtistCandidate ? getArtistPagePath(parsedArtistCandidate) : null;
  const mobileArtistPath = parsedArtistPagePath ? `/m${parsedArtistPagePath}` : null;

  return (
    <div
      role="button"
      tabIndex={0}
      className="mobile-video-card"
      onClick={() => playVideo(video)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playVideo(video);
        }
      }}
    >
      <div className="mobile-video-card-thumb">
        <img
          src={thumbnailUrl}
          alt={video.title}
          className="mobile-video-card-img"
          loading="lazy"
        />
        <div className="mobile-video-card-play-icon">
          <svg viewBox="0 0 24 24" fill="white" width="36" height="36">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      <div className="mobile-video-card-info">
        <span className="mobile-video-card-genre">{video.genre}</span>
        <h3 className="mobile-video-card-title">
          {hasParsedTitlePattern ? (
            <>
              {mobileArtistPath ? (
                <Link
                  href={mobileArtistPath}
                  className="mobile-video-card-artist-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  {parsedArtistLabel}
                </Link>
              ) : (
                <span>{parsedArtistLabel}</span>
              )}
              <span aria-hidden="true"> - </span>
              <span>{parsedTrackCandidate}</span>
            </>
          ) : (
            video.title
          )}
        </h3>
        {video.favourited > 0 && (
          <span className="mobile-video-card-favcount">
            ❤️ {video.favourited.toLocaleString()}
          </span>
        )}
      </div>
      {auth?.isLoggedIn && (
        <div className="mobile-video-card-actions">
          <MobileFavouriteButton videoId={video.id} size="sm" initialFavourited={initialFavourited} />
        </div>
      )}
    </div>
  );
}

type MobileVideoListProps = {
  videos: MobileVideo[];
  initialFavourited?: boolean;
};

export function MobileVideoList({ videos, initialFavourited }: MobileVideoListProps) {
  if (videos.length === 0) {
    return (
      <div className="mobile-empty-state">
        <p>No videos found.</p>
      </div>
    );
  }

  return (
    <div className="mobile-video-list">
      {videos.map((video) => (
        <MobileVideoCard key={video.id} video={video} initialFavourited={initialFavourited} />
      ))}
    </div>
  );
}