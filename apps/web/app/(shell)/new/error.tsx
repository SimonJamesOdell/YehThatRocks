"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type NewPageErrorProps = {
  error: Error;
  reset: () => void;
};

export default function NewPageError({ error, reset }: NewPageErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/new"
      mainAriaLabel="New videos unavailable"
      panelAriaLabel="New videos unavailable"
      eyebrow="New videos status"
      title="New videos temporarily unavailable"
      backHref="/new"
      backLabel="Back to new"
    />
  );
}