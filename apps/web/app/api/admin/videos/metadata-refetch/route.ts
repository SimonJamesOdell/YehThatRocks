import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withAuthAndBody } from "@/lib/api-route-pipeline";
import { buildNormalizedVideoTitleFromMetadata } from "@/lib/catalog-data-utils";
import { deriveAdminImportFallbackMetadata, normalizePossiblyMojibakeText } from "@/lib/catalog-metadata-utils";
import { prisma } from "@/lib/db";
import { PLAYBACK_MIN_CONFIDENCE } from "@/lib/playback-config";

const refetchSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
});

type OEmbedPayload = {
  title?: string;
  author_name?: string;
};

async function fetchOEmbed(videoId: string): Promise<{ title: string | null; channelTitle: string | null }> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return { title: null, channelTitle: null };
    }

    const payload = (await response.json()) as OEmbedPayload;

    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const channelTitle = typeof payload.author_name === "string" ? payload.author_name.trim() : "";

    return {
      title: title || null,
      channelTitle: channelTitle || null,
    };
  } catch {
    return { title: null, channelTitle: null };
  }
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, refetchSchema, {
    authMode: "admin",
    adminPermission: "admin.videos.catalog.edit",
  });

  if (!result.ok) {
    return result.response;
  }

  const { videoId } = result.data;

  const rows = await prisma.$queryRawUnsafe<Array<{
    title: string | null;
    channelTitle: string | null;
    parsedArtist: string | null;
    parsedTrack: string | null;
    genre: string | null;
  }>>(
    `
      SELECT
        title,
        channelTitle,
        parsedArtist,
        parsedTrack,
        genre
      FROM videos
      WHERE videoId = ?
      LIMIT 1
    `,
    videoId,
  );

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const oembed = await fetchOEmbed(videoId);

  const sourceTitle = normalizePossiblyMojibakeText(oembed.title ?? row.title ?? "").trim();
  const sourceChannelTitle = normalizePossiblyMojibakeText(oembed.channelTitle ?? row.channelTitle ?? "").trim();

  const fallback = deriveAdminImportFallbackMetadata(
    sourceTitle,
    sourceChannelTitle,
    PLAYBACK_MIN_CONFIDENCE,
  );

  const fallbackArtist = normalizePossiblyMojibakeText(fallback?.artist ?? "").trim();
  const fallbackTrack = normalizePossiblyMojibakeText(fallback?.track ?? "").trim();

  const existingArtist = normalizePossiblyMojibakeText(row.parsedArtist ?? "").trim();
  const existingTrack = normalizePossiblyMojibakeText(row.parsedTrack ?? "").trim();

  const parsedArtist = fallbackArtist || existingArtist || null;
  const parsedTrack = fallbackTrack || existingTrack || null;

  const normalizedTitle = buildNormalizedVideoTitleFromMetadata(
    sourceTitle || row.title,
    parsedArtist,
    parsedTrack,
  );

  return NextResponse.json({
    ok: true,
    videoId,
    existing: {
      title: row.title,
      channelTitle: row.channelTitle,
      parsedArtist: row.parsedArtist,
      parsedTrack: row.parsedTrack,
      genre: row.genre,
    },
    fetched: {
      title: sourceTitle || null,
      channelTitle: sourceChannelTitle || null,
    },
    suggested: {
      title: normalizedTitle ?? sourceTitle ?? row.title ?? "",
      parsedArtist,
      parsedTrack,
      genre: row.genre ?? "",
    },
  });
}
