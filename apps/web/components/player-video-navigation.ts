import { LIVE_SEARCH_PARAMS_EVENT } from "@/hooks/use-live-search-params";

export function buildVideoNavigationHref({
  videoId,
  pathname,
  baseSearchParams,
  clearPlaylist,
  playlistId,
  playlistItemIndex,
}: {
  videoId: string;
  pathname: string;
  baseSearchParams: URLSearchParams;
  clearPlaylist?: boolean;
  playlistId?: string | null;
  playlistItemIndex?: number | null;
}) {
  const params = new URLSearchParams(baseSearchParams.toString());
  params.set("v", videoId);

  if (clearPlaylist) {
    params.delete("pl");
    params.delete("pli");
  } else if (playlistId) {
    params.set("pl", playlistId);

    if (playlistItemIndex !== null && playlistItemIndex !== undefined) {
      params.set("pli", String(playlistItemIndex));
    } else {
      params.delete("pli");
    }
  }

  return `${pathname}?${params.toString()}`;
}

export function navigateVideoHref({
  href,
  useNativeHistory,
  routerPush,
}: {
  href: string;
  useNativeHistory?: boolean;
  routerPush: (nextHref: string) => void;
}) {
  if (useNativeHistory && typeof window !== "undefined") {
    window.history.pushState(window.history.state, "", href);
    window.dispatchEvent(new CustomEvent(LIVE_SEARCH_PARAMS_EVENT));
    // Do NOT fire a synthetic PopStateEvent — Next.js App Router already
    // monkey-patches history.pushState to detect URL changes.  A synthetic
    // popstate races with Next.js's own detection and can cause the router
    // to fall back to a full-page reload instead of a client-side transition.
    return;
  }

  routerPush(href);
}
