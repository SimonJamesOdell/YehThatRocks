import type { VideoRecord } from "@/lib/catalog";

export type RouteAutoplaySource =
  | { type: "new" }
  | { type: "top100" }
  | { type: "favourites" }
  | { type: "category"; slug: string }
  | { type: "artist"; slug: string };

export type NextChoiceVideo = VideoRecord;

export function formatAutoplayPlaylistTimestamp(now: Date) {
  return `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function resolveRouteAutoplaySource(pathname: string): RouteAutoplaySource | null {
  const onNewRoute = pathname === "/new";
  const onTop100Route = pathname === "/top100";
  const onFavouritesRoute = pathname === "/favourites";
  const onCategoryRoute = pathname.startsWith("/categories/");
  const onArtistRoute = pathname.startsWith("/artist/");

  if (onNewRoute) {
    return { type: "new" };
  }

  if (onTop100Route) {
    return { type: "top100" };
  }

  if (onFavouritesRoute) {
    return { type: "favourites" };
  }

  if (onCategoryRoute) {
    const slug = pathname.slice("/categories/".length).split("/")[0] ?? "";
    return slug ? { type: "category", slug } : null;
  }

  if (onArtistRoute) {
    const slug = pathname.slice("/artist/".length).split("/")[0] ?? "";
    return slug ? { type: "artist", slug } : null;
  }

  return null;
}

export function buildRouteAutoplayPlaylistName(source: RouteAutoplaySource, now = new Date()) {
  const timestamp = formatAutoplayPlaylistTimestamp(now);

  switch (source.type) {
    case "new":
      return `New autoplay ${timestamp}`;
    case "top100":
      return `Top 100 autoplay ${timestamp}`;
    case "favourites":
      return `Favourites autoplay ${timestamp}`;
    case "category": {
      const readableCategory = decodeURIComponent(source.slug).replace(/-/g, " ");
      return `${readableCategory} autoplay ${timestamp}`;
    }
    case "artist": {
      const readableArtist = decodeURIComponent(source.slug).replace(/-/g, " ");
      return `${readableArtist} autoplay ${timestamp}`;
    }
  }
}

export function buildRouteAutoplayTelemetryMode(source: RouteAutoplaySource) {
  return `${source.type}-autoplay`;
}
