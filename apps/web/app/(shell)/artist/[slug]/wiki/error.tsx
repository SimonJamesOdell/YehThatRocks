"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ArtistWikiErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ArtistWikiError({ error, reset }: ArtistWikiErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/artist/[slug]/wiki"
      mainAriaLabel="Artist wiki unavailable"
      panelAriaLabel="Artist wiki unavailable"
      eyebrow="Artist wiki status"
      title="Artist wiki temporarily unavailable"
      backHref="/artists"
      backLabel="Back to artists"
    />
  );
}