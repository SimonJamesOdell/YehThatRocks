import { NextRequest, NextResponse } from "next/server";

import { filterHiddenVideos, getArtistBySlug, getArtists, getTopVideos } from "@/lib/catalog-data";
import { getOptionalApiAuth } from "@/lib/auth-request";

type ArtistRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: NextRequest, context: ArtistRouteContext) {
  const { slug } = await context.params;
  const artist = await getArtistBySlug(slug);

  if (!artist) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  const topVideos = await getTopVideos();
  let matchingVideos = topVideos.filter((video) => {
    return video.channelTitle.toLowerCase().includes(artist.name.toLowerCase());
  });

  // Filter blocked videos if user is authenticated
  const authResult = await getOptionalApiAuth(_request);
  if (authResult?.userId) {
    matchingVideos = await filterHiddenVideos(matchingVideos, authResult.userId);
  }

  const relatedArtists = (await getArtists()).filter((entry) => entry.slug !== artist.slug).slice(0, 4);

  return NextResponse.json({
    artist,
    videos: matchingVideos,
    relatedArtists
  });
}
