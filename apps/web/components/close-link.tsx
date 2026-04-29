"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";

function CloseLinkInner() {
  const searchParams = useSearchParams();
  const v = searchParams.get("v");
  const closeHref = v ? `/?v=${encodeURIComponent(v)}&resume=1` : "/";

  return (
    <Link
      href={closeHref}
      className="favouritesBlindClose"
      data-overlay-close="true"
      onClick={(event) => {
        if (
          event.defaultPrevented
          || event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
        ) {
          return;
        }

        event.preventDefault();
        dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href: closeHref });
      }}
    >
      Close
    </Link>
  );
}

export function CloseLink() {
  return (
    <Suspense fallback={<span className="favouritesBlindClose">Close</span>}>
      <CloseLinkInner />
    </Suspense>
  );
}
