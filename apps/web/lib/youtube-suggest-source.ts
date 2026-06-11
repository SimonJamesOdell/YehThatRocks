import { normalizeYouTubeVideoId } from "@/lib/catalog-data";
import { maybeNormalizePlaylistId } from "@/lib/youtube-playlist";

export type YouTubeSuggestSource =
  | { kind: "video"; videoId: string }
  | { kind: "playlist"; playlistId: string }
  | { kind: "channel"; channelId?: string; channelHandle?: string; channelUsername?: string; channelCustomName?: string };

export function parseYouTubeSuggestSource(source: string): YouTubeSuggestSource | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  // Lazily computed — only needed for plain video ID fallback at end of function.
  let _normalizedVideoId: string | null | undefined;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    const pathLower = path.toLowerCase();

    const isYouTubeHost =
      host === "youtube.com"
      || host === "www.youtube.com"
      || host === "m.youtube.com"
      || host === "music.youtube.com";

    if (isYouTubeHost) {
      const channelIdMatch = path.match(/^\/channel\/(UC[0-9A-Za-z_-]{20,})(?:\/.*)?$/i);
      if (channelIdMatch?.[1]) {
        return { kind: "channel", channelId: channelIdMatch[1] };
      }

      const handleMatch = path.match(/^\/@([A-Za-z0-9._-]{3,})/);
      if (handleMatch?.[1]) {
        return { kind: "channel", channelHandle: handleMatch[1] };
      }

      const userMatch = path.match(/^\/user\/([A-Za-z0-9._-]{3,})(?:\/.*)?$/i);
      if (userMatch?.[1]) {
        return { kind: "channel", channelUsername: userMatch[1] };
      }

      const customMatch = path.match(/^\/c\/([A-Za-z0-9._-]{3,})(?:\/.*)?$/i);
      if (customMatch?.[1]) {
        return { kind: "channel", channelCustomName: customMatch[1] };
      }
    }

    const listParam = url.searchParams.get("list");
    const playlistIdFromQuery = maybeNormalizePlaylistId(listParam);

    if (playlistIdFromQuery) {
      return { kind: "playlist", playlistId: playlistIdFromQuery };
    }

    // /playlist paths without a list param produce no valid playlist ID;
    // let parsing fall through to the video-ID and bare-playlist-ID checks below.
  } catch {
    const playlistParamMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]{10,})/i);
    if (playlistParamMatch?.[1]) {
      return { kind: "playlist", playlistId: playlistParamMatch[1] };
    }
  }

  const normalizedVideoId = (_normalizedVideoId ??= normalizeYouTubeVideoId(trimmed));
  if (normalizedVideoId) {
    return { kind: "video", videoId: normalizedVideoId };
  }

  const barePlaylistId = maybeNormalizePlaylistId(trimmed);
  if (barePlaylistId && /^(PL|UU|LL|RD|OLAK5uy_)/.test(barePlaylistId)) {
    return { kind: "playlist", playlistId: barePlaylistId };
  }

  return null;
}