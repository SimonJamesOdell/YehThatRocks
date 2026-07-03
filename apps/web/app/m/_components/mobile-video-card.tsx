"use client";

import { useMobilePlayer, type MobileVideo } from "./mobile-player-context";
import { MobileFavouriteButton } from "./mobile-favourite-button";

type MobileVideoCardProps = {
  video: MobileVideo;
};

export function MobileVideoCard({ video }: MobileVideoCardProps) {
  const { playVideo, auth } = useMobilePlayer();

  const thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`;
  const artistName = video.parsedArtist || video.channelTitle;

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
        <h3 className="mobile-video-card-title">{video.title}</h3>
        <span className="mobile-video-card-artist-link">
          {artistName}
        </span>
        <div className="mobile-video-card-meta">
          <span className="mobile-video-card-genre-link">
            {video.genre}
          </span>
          {video.favourited > 0 && (
            <span className="mobile-video-card-favcount">
              ❤️ {video.favourited.toLocaleString()}
            </span>
          )}
        </div>
      </div>
      {auth?.isLoggedIn && (
        <div className="mobile-video-card-actions">
          <MobileFavouriteButton videoId={video.id} size="sm" />
        </div>
      )}
    </div>
  );
}

type MobileVideoListProps = {
  videos: MobileVideo[];
};

export function MobileVideoList({ videos }: MobileVideoListProps) {
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
        <MobileVideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}