"use client";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";

type PlaylistTrack = {
  id: string;
  title: string;
  channelTitle: string;
};

type PlaylistTrackCardContentProps = {
  track: PlaylistTrack;
  index: number;
};

export function PlaylistTrackCardContent({
  track,
  index,
}: PlaylistTrackCardContentProps) {
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
        <h3>{track.title}</h3>
        <p>
          <ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">
            {track.channelTitle}
          </ArtistWikiLink>
        </p>
      </div>
    </>
  );
}
