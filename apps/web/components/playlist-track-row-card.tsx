"use client";

import Link from "next/link";

import { PlaylistTrackCardContent } from "@/components/playlist-track-card-content";
import type { PlaylistRailVideo } from "@/components/use-playlist-rail";

type PlaylistTrackRowCardProps = {
  track: PlaylistRailVideo;
  index: number;
  playlistId: string;
  isCurrentPlaylistTrack: boolean;
  isTrackRemoving: boolean;
  isTrackMutating: boolean;
  onRemove: (track: PlaylistRailVideo, index: number) => void;
};

export function PlaylistTrackRowCard({
  track,
  index,
  playlistId,
  isCurrentPlaylistTrack,
  isTrackRemoving,
  isTrackMutating,
  onRemove,
}: PlaylistTrackRowCardProps) {
  return (
    <>
      <button
        type="button"
        className="relatedCardHideButton"
        aria-label={`Remove ${track.title} from playlist`}
        title="Remove from playlist"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove(track, index);
        }}
        disabled={isTrackRemoving || isTrackMutating}
      >
        ×
      </button>
      <Link
        href={`/?v=${track.id}&pl=${encodeURIComponent(playlistId)}&pli=${index}`}
        className={`relatedCard linkedCard rightRailPlaylistTrackCard${isCurrentPlaylistTrack ? " relatedCardActive" : ""}`}
        prefetch={false}
        draggable={false}
      >
        <PlaylistTrackCardContent track={track} index={index} />
      </Link>
    </>
  );
}
