"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ServiceFailurePanel } from "@/components/service-failure-panel";
import { OPERATIONAL_RETRY_LATER_MESSAGE } from "@/lib/operational-error-copy";

type CategoryErrorProps = {
  error: Error;
  reset: () => void;
};

export default function CategoryError({ error, reset }: CategoryErrorProps) {
  useEffect(() => {
    console.error("[categories/[slug]] route error", error);
  }, [error]);

  return (
    <ServiceFailurePanel
      mainAriaLabel="Category unavailable"
      panelAriaLabel="Category unavailable"
      eyebrow="Category status"
      title="Category temporarily unavailable"
      lead={OPERATIONAL_RETRY_LATER_MESSAGE}
      actions={(
        <>
          <button type="button" className="serviceFailureActionPrimary" onClick={reset}>
            Try again
          </button>
          <Link href="/categories" className="serviceFailureActionSecondary">
            Back to categories
          </Link>
        </>
      )}
    />
  );
}
