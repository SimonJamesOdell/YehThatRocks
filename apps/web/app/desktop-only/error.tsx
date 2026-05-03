"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type DesktopOnlyErrorProps = {
  error: Error;
  reset: () => void;
};

export default function DesktopOnlyError({ error, reset }: DesktopOnlyErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="desktop-only"
      mainAriaLabel="Page unavailable"
      panelAriaLabel="Page unavailable"
      eyebrow="Page status"
      title="Page temporarily unavailable"
      backHref="/"
      backLabel="Back to home"
    />
  );
}