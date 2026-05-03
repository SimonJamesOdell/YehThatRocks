"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type VerifyEmailErrorProps = {
  error: Error;
  reset: () => void;
};

export default function VerifyEmailError({ error, reset }: VerifyEmailErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/verify-email"
      mainAriaLabel="Email verification unavailable"
      panelAriaLabel="Email verification unavailable"
      eyebrow="Verification status"
      title="Email verification temporarily unavailable"
      backHref="/"
      backLabel="Back to home"
    />
  );
}