"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ArtistsErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ArtistsError({ error, reset }: ArtistsErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/artists"
      mainAriaLabel="Artists unavailable"
      panelAriaLabel="Artists unavailable"
      eyebrow="Artists status"
      title="Artists temporarily unavailable"
      backHref="/artists"
      backLabel="Back to artists"
    />
  );
}