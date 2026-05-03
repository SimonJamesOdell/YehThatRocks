"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ForgotPasswordErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ForgotPasswordError({ error, reset }: ForgotPasswordErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/forgot-password"
      mainAriaLabel="Password reset unavailable"
      panelAriaLabel="Password reset unavailable"
      eyebrow="Password reset status"
      title="Password reset temporarily unavailable"
      backHref="/login"
      backLabel="Back to login"
    />
  );
}