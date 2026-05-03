"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type UserProfileErrorProps = {
  error: Error;
  reset: () => void;
};

export default function UserProfileError({ error, reset }: UserProfileErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/u/[screenName]"
      mainAriaLabel="Profile unavailable"
      panelAriaLabel="Profile unavailable"
      eyebrow="Profile status"
      title="Profile temporarily unavailable"
      backHref="/"
      backLabel="Back to home"
    />
  );
}