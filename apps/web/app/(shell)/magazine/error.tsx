"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type MagazineErrorProps = {
  error: Error;
  reset: () => void;
};

export default function MagazineError({ error, reset }: MagazineErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/magazine"
      mainAriaLabel="Magazine unavailable"
      panelAriaLabel="Magazine unavailable"
      eyebrow="Magazine status"
      title="Magazine temporarily unavailable"
      backHref="/magazine"
      backLabel="Back to magazine"
    />
  );
}