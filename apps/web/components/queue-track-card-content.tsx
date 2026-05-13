"use client";

import { ArtistWikiLink } from "@/components/artist-wiki-link";
import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";

type QueueTrack = {
  id: string;
  title: string;
  channelTitle: string;
  isFavouriteSource?: boolean;
  isTop100Source?: boolean;
  isNewSource?: boolean;
};

type QueueTrackCardContentProps = {
  track: QueueTrack;
  index: number;
};

export function QueueTrackCardContent({ track, index }: QueueTrackCardContentProps) {
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
