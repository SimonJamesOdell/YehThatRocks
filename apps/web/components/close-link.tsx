"use client";

import Link from "next/link";
import { Suspense, useCallback } from "react";

import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { useLiveSearchParams } from "@/hooks/use-live-search-params";

function CloseLinkInner({ videoId }: { videoId?: string }) {
  const searchParams = useLiveSearchParams();
  // When an explicit videoId is provided (e.g. from a magazine article page),
  // use it as the close target instead of reading ?v= from the current URL.
  // The magazine page URL has no ?v= param, so without this override the close
  // button falls back to the currentVideoId (the default video behind the overlay).
  const resolvedVideoId = videoId ?? searchParams.get("v") ?? undefined;
  const closeHref = resolvedVideoId
    ? `/?v=${encodeURIComponent(resolvedVideoId)}&resume=1`
    : "/";

  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
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
    // Prefer the explicit videoId prop; fall back to the live search params.
    // useLiveSearchParams syncs from window.location.search and listens for
    // LIVE_SEARCH_PARAMS_EVENT (dispatched by navigateVideoHref after native
    // history.pushState), so it's always current even when Next.js's
    // useSearchParams lags behind.
    const currentV = videoId ?? searchParams.get("v") ?? undefined;
    const href = currentV
      ? `/?v=${encodeURIComponent(currentV)}&resume=1`
      : "/";
    dispatchAppEvent(EVENT_NAMES.OVERLAY_CLOSE_REQUEST, { href });
  }, [videoId, searchParams]);

  return (
    <Link
      href={closeHref}
      className="favouritesBlindClose"
      data-overlay-close="true"
      onClick={handleClick}
    >
      Close
    </Link>
  );
}

export function CloseLink({ videoId }: { videoId?: string | null }) {
  return (
    <Suspense fallback={<span className="favouritesBlindClose">Close</span>}>
      <CloseLinkInner videoId={videoId ?? undefined} />
    </Suspense>
  );
}
