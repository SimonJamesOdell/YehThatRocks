import { LIVE_SEARCH_PARAMS_EVENT } from "@/components/use-live-search-params";

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
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }

  routerPush(href);
}
