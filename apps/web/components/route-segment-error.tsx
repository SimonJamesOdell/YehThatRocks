"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ServiceFailurePanel } from "@/components/service-failure-panel";

type RouteSegmentErrorProps = {
  error: Error;
  reset: () => void;
  logKey: string;
  mainAriaLabel: string;
  panelAriaLabel: string;
  eyebrow: string;
  title: string;
  lead?: string;
  backHref: string;
  backLabel: string;
};

export function RouteSegmentError({
  error,
  reset,
  logKey,
  mainAriaLabel,
  panelAriaLabel,
  eyebrow,
  title,
  lead = "The system cannot serve this request right now. Please try again later.",
  backHref,
  backLabel,
}: RouteSegmentErrorProps) {
  useEffect(() => {
    console.error(`[${logKey}] route error`, error);
  }, [error, logKey]);

  return (
    <ServiceFailurePanel
      mainAriaLabel={mainAriaLabel}
      panelAriaLabel={panelAriaLabel}
      eyebrow={eyebrow}
      title={title}
      lead={lead}
      actions={(
        <>
          <button type="button" className="serviceFailureActionPrimary" onClick={reset}>
            Try again
          </button>
          <Link href={backHref} className="serviceFailureActionSecondary">
            {backLabel}
          </Link>
        </>
      )}
    />
  );
}