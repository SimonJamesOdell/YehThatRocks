"use client";

import { useMobilePlayer, type MobileVideo } from "./mobile-player-context";

type MobileVideoCardProps = {
  video: MobileVideo;
};

export function MobileVideoCard({ video }: MobileVideoCardProps) {
  const { playVideo } = useMobilePlayer();

  const thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/mqdefault.jpg`;

  return (
    <button
      type="button"
      className="mobile-video-card"
      onClick={() => playVideo(video)}
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
        <p className="mobile-video-card-artist">
          {video.parsedArtist || video.channelTitle}
        </p>
        <p className="mobile-video-card-genre">{video.genre}</p>
      </div>
    </button>
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
