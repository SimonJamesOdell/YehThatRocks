"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type RegisterErrorProps = {
  error: Error;
  reset: () => void;
};

export default function RegisterError({ error, reset }: RegisterErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/register"
      mainAriaLabel="Register unavailable"
      panelAriaLabel="Register unavailable"
      eyebrow="Register status"
      title="Registration temporarily unavailable"
      backHref="/"
      backLabel="Back to home"
    />
  );
}