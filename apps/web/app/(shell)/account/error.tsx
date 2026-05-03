"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type AccountErrorProps = {
  error: Error;
  reset: () => void;
};

export default function AccountError({ error, reset }: AccountErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/account"
      mainAriaLabel="Account unavailable"
      panelAriaLabel="Account unavailable"
      eyebrow="Account status"
      title="Account temporarily unavailable"
      backHref="/account"
      backLabel="Back to account"
    />
  );
}