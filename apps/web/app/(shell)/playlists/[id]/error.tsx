"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type PlaylistDetailErrorProps = {
  error: Error;
  reset: () => void;
};

export default function PlaylistDetailError({ error, reset }: PlaylistDetailErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/playlists/[id]"
      mainAriaLabel="Playlist unavailable"
      panelAriaLabel="Playlist unavailable"
      eyebrow="Playlist status"
      title="Playlist temporarily unavailable"
      backHref="/playlists"
      backLabel="Back to playlists"
    />
  );
}