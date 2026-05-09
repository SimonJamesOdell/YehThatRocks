import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { verifySameOrigin } from "@/lib/csrf";
import { parseRequestJson } from "@/lib/request-json";

const refetchDateSchema = z.object({
  id: z.number().int().positive(),
  videoId: z.string().trim().min(1).max(64),
});

type YouTubeVideoDetailsResponse = {
  items?: Array<{
    snippet?: {
      publishedAt?: string;
    };
  }>;
};

async function fetchYouTubePublishedAt(videoId: string, apiKey: string): Promise<Date | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
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
  const publishedAtRaw = payload?.items?.[0]?.snippet?.publishedAt;
  if (!publishedAtRaw || !Number.isFinite(Date.parse(publishedAtRaw))) {
    return null;
  }

  return new Date(publishedAtRaw);
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

  const parsed = refetchDateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const youtubeApiKey = process.env.YOUTUBE_DATA_API_KEY?.trim() || "";
  if (!youtubeApiKey) {
    return NextResponse.json({ error: "YouTube API key is not configured." }, { status: 503 });
  }

  const row = await prisma.video.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, videoId: true, createdAt: true },
  });

  if (!row || row.videoId !== parsed.data.videoId) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const publishedAt = await fetchYouTubePublishedAt(parsed.data.videoId, youtubeApiKey);
  if (!publishedAt) {
    return NextResponse.json({ error: "Could not fetch publish date from YouTube." }, { status: 502 });
  }

  const updated = await prisma.video.update({
    where: { id: row.id },
    data: {
      createdAt: publishedAt,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      videoId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    video: {
      id: updated.id,
      videoId: updated.videoId,
      createdAt: updated.createdAt,
    },
  });
}
