"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ArtistsSlugErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ArtistsSlugError({ error, reset }: ArtistsSlugErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/artists/[slug]"
      mainAriaLabel="Artist unavailable"
      panelAriaLabel="Artist unavailable"
      eyebrow="Artist status"
      title="Artist temporarily unavailable"
      backHref="/artists"
      backLabel="Back to artists"
    />
  );
}