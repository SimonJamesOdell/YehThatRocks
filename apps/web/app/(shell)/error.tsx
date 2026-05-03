"use client";

import Link from "next/link";
import { useEffect } from "react";

type ShellErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ShellError({ error, reset }: ShellErrorProps) {
  useEffect(() => {
    console.error("[shell/error] route error", error);
  }, [error]);

  return (
    <main className="serviceFailureScreen" role="main" aria-label="Service unavailable">
      <div className="serviceFailureBackdrop" aria-hidden="true" />
      <section className="serviceFailurePanel" role="status" aria-live="polite" aria-label="Service unavailable">
        <p className="serviceFailureEyebrow">Service state</p>
        <h2 className="serviceFailureTitle">Service temporarily unavailable</h2>
        <p className="serviceFailureLead">
          The system cannot serve this request right now. Please try again later.
        </p>

        <div className="serviceFailureActions">
          <button type="button" className="serviceFailureActionPrimary" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="serviceFailureActionSecondary">
            Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
