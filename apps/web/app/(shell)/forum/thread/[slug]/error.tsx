"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ForumThreadErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ForumThreadError({ error, reset }: ForumThreadErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/forum/thread"
      mainAriaLabel="Thread unavailable"
      panelAriaLabel="Thread unavailable"
      eyebrow="Thread status"
      title="Thread temporarily unavailable"
      backHref="/forum"
      backLabel="Back to forum"
    />
  );
}
