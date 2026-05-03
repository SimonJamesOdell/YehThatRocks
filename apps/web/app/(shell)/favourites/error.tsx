"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type FavouritesErrorProps = {
  error: Error;
  reset: () => void;
};

export default function FavouritesError({ error, reset }: FavouritesErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/favourites"
      mainAriaLabel="Favourites unavailable"
      panelAriaLabel="Favourites unavailable"
      eyebrow="Favourites status"
      title="Favourites temporarily unavailable"
      backHref="/favourites"
      backLabel="Back to favourites"
    />
  );
}