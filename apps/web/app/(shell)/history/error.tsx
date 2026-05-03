"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type HistoryErrorProps = {
  error: Error;
  reset: () => void;
};

export default function HistoryError({ error, reset }: HistoryErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/history"
      mainAriaLabel="History unavailable"
      panelAriaLabel="History unavailable"
      eyebrow="History status"
      title="History temporarily unavailable"
      backHref="/history"
      backLabel="Back to history"
    />
  );
}