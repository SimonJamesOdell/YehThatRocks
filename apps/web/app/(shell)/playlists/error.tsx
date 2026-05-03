"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type PlaylistsErrorProps = {
  error: Error;
  reset: () => void;
};

export default function PlaylistsError({ error, reset }: PlaylistsErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/playlists"
      mainAriaLabel="Playlists unavailable"
      panelAriaLabel="Playlists unavailable"
      eyebrow="Playlists status"
      title="Playlists temporarily unavailable"
      backHref="/playlists"
      backLabel="Back to playlists"
    />
  );
}