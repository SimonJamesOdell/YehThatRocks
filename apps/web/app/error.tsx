"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type RootErrorProps = {
  error: Error;
  reset: () => void;
};

export default function RootError({ error, reset }: RootErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="app/error"
      mainAriaLabel="Service unavailable"
      panelAriaLabel="Service unavailable"
      eyebrow="Service state"
      title="Service temporarily unavailable"
      backHref="/"
      backLabel="Back to home"
    />
  );
}