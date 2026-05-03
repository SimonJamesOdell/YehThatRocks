"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ServiceFailurePanel } from "@/components/service-failure-panel";

type ShellErrorProps = {
  error: Error;
  reset: () => void;
};

export default function ShellError({ error, reset }: ShellErrorProps) {
  useEffect(() => {
    console.error("[shell/error] route error", error);
  }, [error]);

  return (
    <ServiceFailurePanel
      mainAriaLabel="Service unavailable"
      panelAriaLabel="Service unavailable"
      eyebrow="Service state"
      title="Service temporarily unavailable"
      lead="The system cannot serve this request right now. Please try again later."
      actions={(
        <>
          <button type="button" className="serviceFailureActionPrimary" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="serviceFailureActionSecondary">
            Back to home
          </Link>
        </>
      )}
    />
  );
}
