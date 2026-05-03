"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type SearchErrorProps = {
  error: Error;
  reset: () => void;
};

export default function SearchError({ error, reset }: SearchErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/search"
      mainAriaLabel="Search unavailable"
      panelAriaLabel="Search unavailable"
      eyebrow="Search status"
      title="Search temporarily unavailable"
      backHref="/search"
      backLabel="Back to search"
    />
  );
}