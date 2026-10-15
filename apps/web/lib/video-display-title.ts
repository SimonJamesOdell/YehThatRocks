import { inferArtistFromTitle } from "@/lib/catalog-metadata-utils";
import { inferTrackFromTitle } from "@/lib/infer-track-title";

export type VideoDisplayTitleSource = {
  title: string;
  parsedArtist?: string | null;
  parsedTrack?: string | null;
  channelTitle?: string | null;
};

/**
 * Builds the programmatic display title for a video.
 *
 * The artist and track fields are the single source of truth for how a video's
 * title is presented across the site: the player title, the video link cards,
 * and the browser-tab/page title all derive from these fields. The raw
 * `videos.title` field is only shown on the transient "Now playing" overlay at
 * the start of playback.
 *
 * Fallbacks mirror the player's historical behaviour: parsedArtist falls back
 * to channelTitle and then to a title-inferred artist, and parsedTrack falls
 * back to a title-inferred track. When either part cannot be resolved the raw
 * title is returned unchanged.
 */
export function buildVideoDisplayTitle(source: VideoDisplayTitleSource): string {
  const rawTitle = (source.title ?? "").trim();

  const parsedArtist = (source.parsedArtist ?? "").trim()
    || (source.channelTitle ?? "").trim()
    || (inferArtistFromTitle(rawTitle)?.trim() ?? "");
  const metadataArtist = parsedArtist || "Unknown Artist";
  const parsedTrack = (source.parsedTrack ?? "").trim()
    || inferTrackFromTitle(rawTitle, metadataArtist);

  if (parsedArtist && parsedTrack) {
    return `${parsedArtist} - ${parsedTrack}`;
  }

  return rawTitle;
}
