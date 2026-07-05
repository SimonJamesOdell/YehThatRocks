import { NextRequest, NextResponse } from "next/server";

import { getVideoForSharing, normalizeYouTubeVideoId } from "@/lib/catalog-data";

type VideoPreview = {
  id: string;
  title: string;
  channelTitle: string;
  genre: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
};

/**
 * GET /api/videos/share-previews?ids=id1,id2,id3
 *
 * Batch version of /api/videos/share-preview. Accepts up to 50 video IDs
 * and returns preview data for all found videos in a single response.
 */
export async function GET(request: NextRequest) {
  const rawIds = request.nextUrl.searchParams.get("ids") ?? "";
  const videoIds = rawIds
    .split(",")
    .map((id) => normalizeYouTubeVideoId(id.trim()))
    .filter(Boolean);

  if (videoIds.length === 0) {
    return NextResponse.json({ videos: {} });
  }

  // Cap at 50 to prevent abuse
  const capped = videoIds.slice(0, 50);

  // Fetch all in parallel
  const results = await Promise.all(
    capped.map(async (videoId): Promise<[string, VideoPreview | null]> => {
      try {
        const video = await getVideoForSharing(videoId);
        if (video) {
          return [
            videoId,
            {
              id: video.id,
              title: video.title,
              channelTitle: video.channelTitle,
              genre: video.genre ?? null,
              parsedArtist: video.parsedArtist ?? null,
              parsedTrack: video.parsedTrack ?? null,
            },
          ];
        }
      } catch {
        // Individual failures are non-fatal
      }
      return [videoId, null];
    }),
  );

  const videos: Record<string, VideoPreview | null> = {};
  for (const [id, preview] of results) {
    videos[id] = preview;
  }

  return NextResponse.json({ videos });
}
