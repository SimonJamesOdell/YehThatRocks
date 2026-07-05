"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ForumErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ForumError({ error, reset }: ForumErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/forum"
      mainAriaLabel="Forum unavailable"
      panelAriaLabel="Forum unavailable"
      eyebrow="Forum status"
      title="Forum temporarily unavailable"
      backHref="/forum"
      backLabel="Back to forum"
    />
  );
}
