type RouteAutoplayNavigationParamsOptions = {
  targetVideoId: string;
  playlistId: string | null;
};

export function buildRouteAutoplayNavigationParams(options: RouteAutoplayNavigationParamsOptions) {
  const params = new URLSearchParams();
  params.set("v", options.targetVideoId);
  params.set("resume", "1");

  if (options.playlistId) {
    params.set("pl", options.playlistId);
    params.set("pli", "0");
  }

  return params;
}

export function buildRootAutoplayFallbackParams(searchParams: URLSearchParams, currentVideoId: string) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("v", currentVideoId);
  return params;
}
