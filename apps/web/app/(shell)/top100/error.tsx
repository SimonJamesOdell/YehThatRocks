"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type Top100ErrorProps = {
  error: Error;
  reset: () => void;
};

export default function Top100Error({ error, reset }: Top100ErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/top100"
      mainAriaLabel="Top 100 unavailable"
      panelAriaLabel="Top 100 unavailable"
      eyebrow="Top 100 status"
      title="Top 100 temporarily unavailable"
      backHref="/top100"
      backLabel="Back to top 100"
    />
  );
}