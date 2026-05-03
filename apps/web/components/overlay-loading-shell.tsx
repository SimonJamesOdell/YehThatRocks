import type { ReactNode } from "react";

import { OverlayHeader } from "@/components/overlay-header";

type OverlayLoadingShellProps = {
  /** Simple title forwarded to OverlayHeader (mutually exclusive with breadcrumb). */
  title?: string;
  /** Breadcrumb text forwarded to OverlayHeader (mutually exclusive with title). */
  breadcrumb?: string;
  /** Loading message shown below the spinner bars. */
  message: string;
  /** Custom header node. When provided, overrides title/breadcrumb-based auto header. */
  header?: ReactNode;
};

/**
 * Shared overlay loading skeleton: optional header + animated spinner bars + loading message.
 * Used by segment loading.tsx files that share the routeContractRow/artistLoadingCenter pattern.
 */
export function OverlayLoadingShell({ title, breadcrumb, message, header }: OverlayLoadingShellProps) {
  const resolvedHeader =
    header !== undefined
      ? header
      : title !== undefined || breadcrumb !== undefined
        ? <OverlayHeader title={title} breadcrumb={breadcrumb} />
        : null;

  return (
    <>
      {resolvedHeader}
      <div className="routeContractRow artistLoadingCenter" aria-live="polite" aria-busy="true">
        <span className="playerBootBars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>{message}</span>
      </div>
    </>
  );
}
