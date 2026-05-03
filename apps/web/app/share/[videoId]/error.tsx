"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ShareVideoErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ShareVideoError({ error, reset }: ShareVideoErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="share/[videoId]"
      mainAriaLabel="Shared video unavailable"
      panelAriaLabel="Shared video unavailable"
      eyebrow="Share status"
      title="Shared video temporarily unavailable"
      backHref="/"
      backLabel="Back to home"
    />
  );
}