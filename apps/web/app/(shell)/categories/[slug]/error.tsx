"use client";

import Link from "next/link";
import { useEffect } from "react";

type CategoryErrorProps = {
  error: Error;
  reset: () => void;
};

export default function CategoryError({ error, reset }: CategoryErrorProps) {
  useEffect(() => {
    console.error("[categories/[slug]] route error", error);
  }, [error]);

  return (
    <main className="serviceFailureScreen" role="main" aria-label="Category unavailable">
      <div className="serviceFailureBackdrop" aria-hidden="true" />
      <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label="Category unavailable">
        <p className="serviceFailureEyebrow">Category status</p>
        <h2 className="serviceFailureTitle">Category temporarily unavailable</h2>
        <p className="serviceFailureLead">
          The system cannot serve this request right now. Please try again later.
        </p>

        <div className="serviceFailureActions">
          <button type="button" className="serviceFailureActionPrimary" onClick={reset}>
            Try again
          </button>
          <Link href="/categories" className="serviceFailureActionSecondary">
            Back to categories
          </Link>
        </div>
      </section>
    </main>
  );
}
