"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ArtistErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ArtistError({ error, reset }: ArtistErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/artist/[slug]"
      mainAriaLabel="Artist unavailable"
      panelAriaLabel="Artist unavailable"
      eyebrow="Artist status"
      title="Artist temporarily unavailable"
      backHref="/artists"
      backLabel="Back to artists"
    />
  );
}