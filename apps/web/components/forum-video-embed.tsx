"use client";

import { PlayerExperience } from "@/components/player-experience-core";
import type { VideoRecord } from "@/lib/catalog";

export type VideoEmbedMetadata = {
  title: string;
  channelTitle: string;
  parsedArtist?: string | null;
  parsedTrack?: string | null;
  artistVideoCount?: number | null;
  genre: string;
};

type ForumVideoEmbedProps = {
  videoId: string;
  metadata?: VideoEmbedMetadata | null;
};

export function ForumVideoEmbed({ videoId, metadata }: ForumVideoEmbedProps) {
  const video: VideoRecord = metadata
    ? {
        id: videoId,
        title: metadata.title,
        channelTitle: metadata.channelTitle,
        parsedArtist: metadata.parsedArtist ?? null,
        parsedTrack: metadata.parsedTrack ?? null,
        artistVideoCount: metadata.artistVideoCount ?? null,
        genre: metadata.genre,
        favourited: 0,
        description: "",
      }
    : {
        id: videoId,
        title: videoId,
        channelTitle: "",
        genre: "",
        favourited: 0,
        description: "",
      };

  return (
    <div className="forumEmbeddedPlayer">
      <div className="playerChrome playerChromeDockedDesktop">
        <div className="playerDockLayer">
          <PlayerExperience
            currentVideo={video}
            queue={[video]}
            isLoggedIn={false}
            isDockedDesktop={true}
            suppressAuthWall={true}
          />
        </div>
      </div>
    </div>
  );
}
