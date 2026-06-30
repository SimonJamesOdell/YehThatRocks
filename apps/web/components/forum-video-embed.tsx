"use client";

import { useCallback } from "react";
import { PlayerExperience } from "@/components/player-experience-core";
import { dispatchAppEvent, EVENT_NAMES } from "@/lib/events-contract";
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

  const handlePlayerClick = useCallback(() => {
    dispatchAppEvent(EVENT_NAMES.FORUM_EMBED_PLAYBACK_STARTED, null);
  }, []);

  return (
    <div className="forumEmbeddedPlayer" onClick={handlePlayerClick}>
      <div className="playerChrome">
        <div className="playerDockLayer">
          <PlayerExperience
            currentVideo={video}
            queue={[video]}
            isLoggedIn={false}
            isDockedDesktop={false}
            suppressAuthWall={true}
            stopOnEnd={true}
          />
        </div>
      </div>
    </div>
  );
}