import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  clearCatalogVideoCaches,
  getStoredVideoById,
  hasDatabaseUrl,
  importVideoFromDirectSource,
  normalizeArtistKey,
  normalizeYouTubeVideoId,
  pruneVideoAndAssociationsByVideoId,
} from "@/lib/catalog-data";
import { requireAdminApiAuthWithPermission } from "@/lib/admin-auth";
import { verifySameOrigin } from "@/lib/csrf";
import { parseJsonOrNull } from "@/lib/parse-json";
import { parseRequestJson } from "@/lib/request-json";
import { recordExternalApiUsage } from "@/lib/api-usage-telemetry";

const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || "";

const discoverSchema = z.object({
  artistName: z.string().trim().min(1).max(255),
  maxResults: z.number().int().min(1).max(50).optional(),
});

type YouTubeSearchResponse = {
  items?: Array<{
    id?: {
      videoId?: string;
    };
  }>;
};

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiAuthWithPermission(request, "admin.videos.pending.moderate");

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

  const parsed = discoverSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: false, error: "Database is not configured." }, { status: 503 });
  }

  if (!YOUTUBE_DATA_API_KEY) {
    return NextResponse.json({ ok: false, error: "YouTube API key is not configured." }, { status: 503 });
  }

  const artistName = parsed.data.artistName.trim();
  const normalizedRequestedArtist = normalizeArtistKey(artistName);
  const maxResults = parsed.data.maxResults ?? 20;

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("videoCategoryId", "10");
  endpoint.searchParams.set("maxResults", String(maxResults));
  endpoint.searchParams.set("order", "relevance");
  endpoint.searchParams.set("q", `\"${artistName}\" official music video`);
  endpoint.searchParams.set("key", YOUTUBE_DATA_API_KEY);

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "YehThatRocks/1.0",
    },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    void recordExternalApiUsage({
      provider: "youtube",
      endpoint: "search.list",
      units: 100,
      success: false,
      statusCode: response?.status ?? null,
      note: "admin-artist-discovery-search-failed",
    });

    return NextResponse.json({ ok: false, error: "Could not query YouTube for this artist." }, { status: 502 });
  }

  void recordExternalApiUsage({
    provider: "youtube",
    endpoint: "search.list",
    units: 100,
    success: true,
    statusCode: response.status,
    note: "admin-artist-discovery-search",
  });

  const payload = await parseJsonOrNull<YouTubeSearchResponse>(response);
  const candidateIds = Array.from(
    new Set(
      (payload?.items ?? [])
        .map((item) => normalizeYouTubeVideoId(item.id?.videoId ?? ""))
        .filter((videoId): videoId is string => Boolean(videoId)),
    ),
  );

  if (candidateIds.length === 0) {
    return NextResponse.json({ ok: true, artistName, scanned: 0, imported: 0, queued: 0, skipped: 0, prunedAsMismatch: 0 });
  }

  let imported = 0;
  let queued = 0;
  let skipped = 0;
  let prunedAsMismatch = 0;

  for (const videoId of candidateIds) {
    const existedBefore = Boolean(await getStoredVideoById(videoId, { includeUnapproved: true }));
    const result = await importVideoFromDirectSource(videoId, { discoverRelated: false });

    if (!result.videoId || !result.decision.allowed) {
      skipped += 1;
      continue;
    }

    imported += 1;

    const persisted = await getStoredVideoById(videoId, { includeUnapproved: true });
    const parsedArtist = (persisted?.parsedArtist ?? persisted?.channelTitle ?? "").trim();
    const normalizedParsedArtist = parsedArtist ? normalizeArtistKey(parsedArtist) : "";
    const isArtistMatch = normalizedParsedArtist.length > 0 && normalizedParsedArtist === normalizedRequestedArtist;

    if (!existedBefore && !isArtistMatch) {
      await pruneVideoAndAssociationsByVideoId(videoId, "admin-artist-discovery-artist-mismatch").catch(() => undefined);
      prunedAsMismatch += 1;
      continue;
    }

    if (!existedBefore) {
      queued += 1;
    }
  }

  clearCatalogVideoCaches();

  return NextResponse.json({
    ok: true,
    artistName,
    scanned: candidateIds.length,
    imported,
    queued,
    skipped,
    prunedAsMismatch,
  });
}