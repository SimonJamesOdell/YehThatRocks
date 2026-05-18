import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, getArtistBySlug, getArtists, getStoredVideoById, getVideosByArtist, mapVideo, slugify } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";

type ArtistRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: NextRequest, context: ArtistRouteContext) {
  const { slug } = await context.params;
  const contextVideoId = (_request.nextUrl.searchParams.get("v") ?? "").trim();
  const artist = await getArtistBySlug(slug);

  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  let matchingVideos = await getVideosByArtist(artist.name);

  // Filter blocked videos if user is authenticated
  const authResult = await getOptionalApiAuth(_request);
  if (authResult?.userId) {
    const filtered = await filterHiddenVideos(matchingVideos, authResult.userId);
    if (contextVideoId) {
      const contextVideo = matchingVideos.find((video) => video.id === contextVideoId);
      if (contextVideo && !filtered.some((video) => video.id === contextVideoId)) {
        filtered.unshift(contextVideo);
      }
    }
    matchingVideos = filtered;
  }

  if (contextVideoId && !matchingVideos.some((video) => video.id === contextVideoId)) {
    const contextStored = await getStoredVideoById(contextVideoId, { includeUnapproved: true });
    const contextArtist = (contextStored?.parsedArtist ?? contextStored?.channelTitle ?? "").trim();
    if (contextStored && contextArtist && slugify(contextArtist) === artist.slug) {
      matchingVideos.unshift(mapVideo(contextStored));
    }
  }

  const relatedArtists = (await getArtists())
    .filter((entry: { slug: string }) => entry.slug !== artist.slug)
    .slice(0, 4);

  return NextResponse.json({
    artist,
    videoCount: matchingVideos.length,
    videos: matchingVideos,
    relatedArtists
  });
}
