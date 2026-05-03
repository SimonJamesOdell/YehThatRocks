"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type MagazineSlugErrorProps = {
  error: Error;
  reset: () => void;
};

export default function MagazineSlugError({ error, reset }: MagazineSlugErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/magazine/[slug]"
      mainAriaLabel="Article unavailable"
      panelAriaLabel="Article unavailable"
      eyebrow="Article status"
      title="Article temporarily unavailable"
      backHref="/magazine"
      backLabel="Back to magazine"
    />
  );
}