"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type LoginErrorProps = {
  error: Error;
  reset: () => void;
};

export default function LoginError({ error, reset }: LoginErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/login"
      mainAriaLabel="Login unavailable"
      panelAriaLabel="Login unavailable"
      eyebrow="Login status"
      title="Login temporarily unavailable"
      backHref="/"
      backLabel="Back to home"
    />
  );
}