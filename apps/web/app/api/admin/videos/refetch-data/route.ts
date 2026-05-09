import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const refetchMetadataSchema = z.object({
  id: z.number().int().positive(),
  videoId: z.string().trim().min(1).max(64),
});

type YouTubeVideoDetailsResponse = {
  items?: Array<{
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      channelTitle?: string;
    };
    statistics?: {
      viewCount?: string;
    };
  }>;
};

async function fetchYouTubeMetadata(videoId: string, apiKey: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "YehThatRocks/1.0",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as YouTubeVideoDetailsResponse | null;
  const item = payload?.items?.[0];
  if (!item) {
    return null;
  }

  const snippet = item.snippet;
  const stats = item.statistics;

  const metadata: {
    title?: string;
    description?: string;
    createdAt?: Date;
    channelTitle?: string;
    viewCount?: number;
  } = {};

  if (snippet?.title) {
    metadata.title = snippet.title;
  }

  if (snippet?.description) {
    metadata.description = snippet.description;
  }

  if (snippet?.publishedAt && Number.isFinite(Date.parse(snippet.publishedAt))) {
    metadata.createdAt = new Date(snippet.publishedAt);
  }

  if (snippet?.channelTitle) {
    metadata.channelTitle = snippet.channelTitle;
  }

  if (stats?.viewCount) {
    const viewCount = Number.parseInt(stats.viewCount, 10);
    if (Number.isFinite(viewCount) && viewCount >= 0) {
      metadata.viewCount = viewCount;
    }
  }

  return metadata;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const csrf = verifySameOrigin(request);
  if (csrf) {
    return csrf;
  }

  const body = await parseRequestJson(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = refetchMetadataSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const youtubeApiKey = process.env.YOUTUBE_DATA_API_KEY?.trim() || "";
  if (!youtubeApiKey) {
    return NextResponse.json({ error: "YouTube API key is not configured." }, { status: 503 });
  }

  const row = await prisma.video.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, videoId: true },
  });

  if (!row || row.videoId !== parsed.data.videoId) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const metadata = await fetchYouTubeMetadata(parsed.data.videoId, youtubeApiKey);
  if (!metadata || Object.keys(metadata).length === 0) {
    return NextResponse.json({ error: "Could not fetch metadata from YouTube." }, { status: 502 });
  }

  const updated = await prisma.video.update({
    where: { id: row.id },
    data: {
      ...metadata,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      videoId: true,
      title: true,
      description: true,
      createdAt: true,
      channelTitle: true,
      viewCount: true,
    },
  });

  return NextResponse.json({
    ok: true,
    video: updated,
  });
}
