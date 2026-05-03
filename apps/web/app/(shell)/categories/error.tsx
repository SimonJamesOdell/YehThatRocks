"use client";

import { RouteSegmentError } from "@/components/route-segment-error";

type CategoriesErrorProps = {
  error: Error;
  reset: () => void;
};

export default function CategoriesError({ error, reset }: CategoriesErrorProps) {
  return (
    <RouteSegmentError
      error={error}
      reset={reset}
      logKey="(shell)/categories"
      mainAriaLabel="Categories unavailable"
      panelAriaLabel="Categories unavailable"
      eyebrow="Categories status"
      title="Categories temporarily unavailable"
      backHref="/categories"
      backLabel="Back to categories"
    />
  );
}