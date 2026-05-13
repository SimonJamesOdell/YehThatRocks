"use client";

import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";

type PlaylistSummary = {
  name: string;
  itemCount: number;
  leadVideoId: string;
};

type PlaylistSummaryCardContentProps = {
  playlist: PlaylistSummary;
  hasLeadThumbnail: boolean;
};

export function PlaylistSummaryCardContent({
  playlist,
  hasLeadThumbnail,
}: PlaylistSummaryCardContentProps) {
  return (
    <>
      <div className="thumbGlow">
        {hasLeadThumbnail ? (
          <YouTubeThumbnailImage
            videoId={playlist.leadVideoId}
            alt=""
            loading="lazy"
            className="relatedThumb"
            reportReason="thumbnail-load-error:playlist-summary"
            hideClosestSelector=".rightRailPlaylistCard"
          />
        ) : (
          <div className="playlistRailThumbPlaceholder" aria-hidden="true">♬</div>
        )}
      </div>
      <div>
        <h3>{playlist.name}</h3>
        <p>{playlist.itemCount} {playlist.itemCount === 1 ? "track" : "tracks"}</p>
      </div>
    </>
  );
}
