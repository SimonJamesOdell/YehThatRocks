type ShellOverlayRouteStateParams = {
  pathname: string;
  previousPathname: string | null;
  pendingOverlayOpenKind: "video" | "wiki" | null;
  isOverlayClosing: boolean;
  isUndockSettling: boolean;
  isDockTransitioning: boolean;
};

export type ShellOverlayRouteState = {
  isCategoriesRoute: boolean;
  isArtistsRoute: boolean;
  previousWasCategoriesRoute: boolean;
  previousWasArtistsRoute: boolean;
  isAdminOverlayRoute: boolean;
  isOverlayRoute: boolean;
  shouldShowOverlayPanel: boolean;
  disableOverlayDropAnimation: boolean;
  isPlayerWidthOverlayRoute: boolean;
  overlayPanelClassName: string;
  isMagazineOverlayRoute: boolean;
  isForumOverlayRoute: boolean;
  shouldDisableRelatedRailTransition: boolean;
  shouldOccludeLeftRail: boolean;
  shouldOccludeRightRail: boolean;
  isArtistsIndexRoute: boolean;
  shouldDockDesktopPlayer: boolean;
  shouldDockUnderArtistsAlphabet: boolean;
  shouldKeepDockedDesktopPresentation: boolean;
};

export function isCategoriesOverlayPath(pathname: string) {
  return pathname === "/categories" || pathname.startsWith("/categories/");
}

export function isArtistsOverlayPath(pathname: string) {
  return pathname === "/artists" || pathname.startsWith("/artists/");
}

export function isRouteActive(href: string, pathname: string) {
  if (href === pathname) return true;
  // /artists nav item should also highlight for /artist/[slug]
  if (href === "/artists" && pathname.startsWith("/artist/")) return true;
  // all other nav items: highlight for sub-paths
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

export function isProtectedOverlayPath(pathname: string) {
  return pathname === "/favourites"
    || pathname === "/history"
    || pathname === "/account"
    || pathname === "/playlists"
    || pathname.startsWith("/playlists/");
}

export function deriveShellOverlayRouteState({
  pathname,
  previousPathname,
  pendingOverlayOpenKind,
  isOverlayClosing,
  isUndockSettling,
  isDockTransitioning,
}: ShellOverlayRouteStateParams): ShellOverlayRouteState {
  const isCategoriesRoute = isCategoriesOverlayPath(pathname);
  const isArtistsRoute = pathname === "/artists" || pathname.startsWith("/artist/") || pathname.startsWith("/artists/");
  const previousWasCategoriesRoute = previousPathname === "/categories" || previousPathname?.startsWith("/categories/") === true;
  const previousWasArtistsRoute = previousPathname === "/artists"
    || previousPathname?.startsWith("/artist/") === true
    || previousPathname?.startsWith("/artists/") === true;
  const isAdminOverlayRoute = pathname === "/admin";
  const isOverlayRoute = pathname !== "/";
  const shouldShowOverlayPanel = (isOverlayRoute && !isAdminOverlayRoute) || pendingOverlayOpenKind !== null;
  const disableOverlayDropAnimation =
    (isCategoriesRoute && previousWasCategoriesRoute)
    || (isArtistsRoute && previousWasArtistsRoute);
  const isPlayerWidthOverlayRoute =
    pathname === "/new"
    || pathname === "/top100"
    || pathname === "/history"
    || pathname === "/search";
  const overlayPanelClassName = [
    "favouritesBlind",
    disableOverlayDropAnimation ? "favouritesBlindNoDrop" : "",
    isPlayerWidthOverlayRoute ? "favouritesBlindPlayerWidth" : "",
    isOverlayClosing ? "favouritesBlindClosing" : "",
  ].filter(Boolean).join(" ");
  const isMagazineOverlayRoute = pathname === "/magazine" || pathname.startsWith("/magazine/");
  const isForumOverlayRoute = pathname === "/forum" || pathname.startsWith("/forum/");
  const shouldDisableRelatedRailTransition = pathname === "/new";
  const shouldOccludeLeftRail = shouldShowOverlayPanel && !isMagazineOverlayRoute && !isForumOverlayRoute;
  const shouldOccludeRightRail = shouldShowOverlayPanel && !isMagazineOverlayRoute && !isForumOverlayRoute && pathname !== "/new";
  const isArtistsIndexRoute = pathname === "/artists";
  const shouldDockDesktopPlayer = shouldShowOverlayPanel && !isMagazineOverlayRoute && !isForumOverlayRoute;
  const shouldDockUnderArtistsAlphabet = shouldDockDesktopPlayer && isArtistsIndexRoute;
  const shouldKeepDockedDesktopPresentation = shouldDockDesktopPlayer || isOverlayClosing || isUndockSettling;

  // Keep this input in the signature so call sites remain explicit about
  // dock transition dependencies even when route flags are purely path-driven.
  void isDockTransitioning;

  return {
    isCategoriesRoute,
    isArtistsRoute,
    previousWasCategoriesRoute,
    previousWasArtistsRoute,
    isAdminOverlayRoute,
    isOverlayRoute,
    shouldShowOverlayPanel,
    disableOverlayDropAnimation,
    isPlayerWidthOverlayRoute,
    overlayPanelClassName,
    isMagazineOverlayRoute,
    isForumOverlayRoute,
    shouldDisableRelatedRailTransition,
    shouldOccludeLeftRail,
    shouldOccludeRightRail,
    isArtistsIndexRoute,
    shouldDockDesktopPlayer,
    shouldDockUnderArtistsAlphabet,
    shouldKeepDockedDesktopPresentation,
  };
}
