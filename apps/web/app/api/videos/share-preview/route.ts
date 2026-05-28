import { NextRequest, NextResponse } from "next/server";

import { getVideoForSharing, normalizeYouTubeVideoId } from "@/lib/catalog-data";

type OEmbedPayload = {
  title?: string;
  author_name?: string;
};

async function fetchYouTubeOEmbed(videoId: string): Promise<{ title: string; channelTitle: string } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);

  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as OEmbedPayload;
    const title = payload.title?.trim();
    const channelTitle = payload.author_name?.trim();

    if (!title || !channelTitle) {
      return null;
    }

    return { title, channelTitle };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  const rawVideoId = request.nextUrl.searchParams.get("v") ?? "";
  const videoId = normalizeYouTubeVideoId(rawVideoId);

  if (!videoId) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }

  const video = await getVideoForSharing(videoId).catch(() => null);

  if (video) {
    return NextResponse.json({
      video: {
        id: video.id,
        title: video.title,
        channelTitle: video.channelTitle,
        genre: video.genre ?? null,
        parsedArtist: video.parsedArtist ?? null,
        parsedTrack: video.parsedTrack ?? null,
      },
    });
  }

  const oEmbedVideo = await fetchYouTubeOEmbed(videoId);
  if (!oEmbedVideo) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  return NextResponse.json({
    video: {
      id: videoId,
      title: oEmbedVideo.title,
      channelTitle: oEmbedVideo.channelTitle,
      genre: null,
      parsedArtist: null,
      parsedTrack: null,
    },
  });
}
