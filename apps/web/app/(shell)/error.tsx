"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ServiceFailurePanel } from "@/components/service-failure-panel";
import { OPERATIONAL_RETRY_LATER_MESSAGE } from "@/lib/operational-error-copy";

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
      lead={OPERATIONAL_RETRY_LATER_MESSAGE}
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
