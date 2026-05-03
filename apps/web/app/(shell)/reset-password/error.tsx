"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type ResetPasswordErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ResetPasswordError({ error, reset }: ResetPasswordErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/reset-password"
      mainAriaLabel="Password reset unavailable"
      panelAriaLabel="Password reset unavailable"
      eyebrow="Password reset status"
      title="Password reset temporarily unavailable"
      backHref="/login"
      backLabel="Back to login"
    />
  );
}