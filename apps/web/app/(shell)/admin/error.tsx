"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type AdminErrorProps = {
  error: Error;
  reset: () => void;
};

export default function AdminError({ error, reset }: AdminErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/admin"
      mainAriaLabel="Admin unavailable"
      panelAriaLabel="Admin unavailable"
      eyebrow="Admin status"
      title="Admin temporarily unavailable"
      backHref="/admin"
      backLabel="Back to admin"
    />
  );
}