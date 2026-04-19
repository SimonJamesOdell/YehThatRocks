import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth-request";
import { hasDatabaseUrl, importVideoFromDirectSource, normalizeYouTubeVideoId } from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

const suggestSchema = z.object({
  source: z.string().trim().min(1).max(2048),
  artist: z.string().trim().max(255).optional(),
  track: z.string().trim().max(255).optional(),
});

const YOUTUBE_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || "";
const PLAYBACK_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.PLAYBACK_MIN_CONFIDENCE || "0.8")));
const playlistBatchJobs = new Map<string, Promise<void>>();

function getRejectionReason(decision: { reason: string; message?: string }) {
  if (decision.message?.trim()) {
    return decision.message.trim();
  }

  switch (decision.reason) {
    case "missing-metadata":
      return "Rejected: required artist or track metadata is missing.";
    case "low-confidence":
      return "Rejected: classification confidence is too low.";
    case "unknown-video-type":
      return "Rejected: video type is not eligible for the catalog.";
    case "unavailable":
      return "Rejected: video is unavailable for playback.";
    case "not-found":
      return "Rejected: video could not be found.";
    case "invalid-video-id":
      return "Rejected: invalid YouTube video ID or URL.";
    default:
      return "Rejected during ingestion/classification.";
  }
}

function maybeNormalizePlaylistId(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (!YOUTUBE_PLAYLIST_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function parseYouTubeSource(source: string):
  | { kind: "video"; videoId: string }
  | { kind: "playlist"; playlistId: string }
  | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedVideoId = normalizeYouTubeVideoId(trimmed);

  try {
    const url = new URL(trimmed);
    const playlistIdFromQuery = maybeNormalizePlaylistId(url.searchParams.get("list"));

    if (playlistIdFromQuery) {
      return { kind: "playlist", playlistId: playlistIdFromQuery };
    }

    if (url.pathname.toLowerCase().startsWith("/playlist")) {
      const explicitPlaylist = maybeNormalizePlaylistId(url.searchParams.get("list"));
      if (explicitPlaylist) {
        return { kind: "playlist", playlistId: explicitPlaylist };
      }
    }
  } catch {
    const playlistParamMatch = trimmed.match(/[?&]list=([A-Za-z0-9_-]{10,})/i);
    if (playlistParamMatch?.[1]) {
      return { kind: "playlist", playlistId: playlistParamMatch[1] };
    }
  }

  if (normalizedVideoId) {
    return { kind: "video", videoId: normalizedVideoId };
  }

  const barePlaylistId = maybeNormalizePlaylistId(trimmed);
  if (barePlaylistId && /^(PL|UU|LL|RD|OLAK5uy_)/.test(barePlaylistId)) {
    return { kind: "playlist", playlistId: barePlaylistId };
  }

  return null;
}

async function fetchPlaylistVideoIds(playlistId: string) {
  if (!YOUTUBE_DATA_API_KEY) {
    return { ok: false as const, error: "YouTube Data API key is not configured on the server." };
  }

  const collected = new Set<string>();
  let pageToken: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    endpoint.searchParams.set("part", "contentDetails");
    endpoint.searchParams.set("maxResults", "50");
    endpoint.searchParams.set("playlistId", playlistId);
    endpoint.searchParams.set("key", YOUTUBE_DATA_API_KEY);
    if (pageToken) {
      endpoint.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
      cache: "no-store",
    }).catch(() => null);

    if (!response?.ok) {
      return { ok: false as const, error: "Could not read playlist from YouTube." };
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          items?: Array<{ contentDetails?: { videoId?: string } }>;
          nextPageToken?: string;
        }
      | null;

    for (const item of payload?.items ?? []) {
      const normalizedVideoId = normalizeYouTubeVideoId(item.contentDetails?.videoId);
      if (normalizedVideoId) {
        collected.add(normalizedVideoId);
      }
    }

    if (!payload?.nextPageToken || collected.size >= 1000) {
      break;
    }

    pageToken = payload.nextPageToken;
  }

  return { ok: true as const, videoIds: [...collected] };
}

async function applyMetadataHints(videoId: string, hints: { artist?: string; track?: string }, includeTrack = true) {
  if (!hasDatabaseUrl()) {
    return;
  }

  const artist = hints.artist?.trim() || null;
  const track = includeTrack ? (hints.track?.trim() || null) : null;

  if (!artist && !track) {
    return;
  }

  await prisma.$executeRaw`
    UPDATE videos
    SET
      parsedArtist = COALESCE(${artist}, parsedArtist),
      parsedTrack = COALESCE(${track}, parsedTrack),
      parseMethod = ${"user-suggested"},
      parseReason = ${"new-page-suggestion"},
      parseConfidence = ${1},
      parsedAt = ${new Date()}
    WHERE videoId = ${videoId}
  `;
}

async function loadResolvedVideoMetadata(videoId: string, hints: { artist?: string; track?: string }) {
  const hintedArtist = hints.artist?.trim() || null;
  const hintedTrack = hints.track?.trim() || null;

  if (!hasDatabaseUrl()) {
    return {
      artist: hintedArtist,
      track: hintedTrack,
    };
  }

  const rows = await prisma.$queryRaw<Array<{ parsedArtist: string | null; parsedTrack: string | null }>>`
    SELECT parsedArtist, parsedTrack
    FROM videos
    WHERE videoId = ${videoId}
    LIMIT 1
  `;

  const row = rows[0];
  return {
    artist: row?.parsedArtist?.trim() || hintedArtist,
    track: row?.parsedTrack?.trim() || hintedTrack,
  };
}

async function loadVideoParseConfidence(videoId: string) {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const rows = await prisma.$queryRaw<Array<{ parseConfidence: number | null }>>`
    SELECT parseConfidence
    FROM videos
    WHERE videoId = ${videoId}
    LIMIT 1
  `;

  const value = Number(rows[0]?.parseConfidence ?? NaN);
  return Number.isFinite(value) ? value : null;
}

function startPlaylistBatchIngestion(args: {
  jobKey: string;
  videoIds: string[];
  artist?: string;
  track?: string;
}) {
  const { jobKey, videoIds, artist, track } = args;

  if (playlistBatchJobs.has(jobKey)) {
    return;
  }

  const job = (async () => {
    for (const videoId of videoIds) {
      try {
        const result = await importVideoFromDirectSource(videoId);
        if (result.videoId) {
          await applyMetadataHints(result.videoId, { artist, track }, false);
        }
      } catch {
        // Continue processing remaining playlist items.
      }
    }
  })().finally(() => {
    playlistBatchJobs.delete(jobKey);
  });

  playlistBatchJobs.set(jobKey, job);
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) {
    return authResult.response;
  }

  const csrfError = verifySameOrigin(request);
  if (csrfError) {
    return csrfError;
  }

  const bodyResult = await parseRequestJson(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = suggestSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const source = parseYouTubeSource(parsed.data.source);
  if (!source) {
    return NextResponse.json({ ok: false, error: "Invalid YouTube URL, video id, or playlist URL." }, { status: 400 });
  }

  if (source.kind === "video") {
    const existingRows = hasDatabaseUrl()
      ? await prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id
          FROM videos
          WHERE videoId = ${source.videoId}
          LIMIT 1
        `
      : [];
    const alreadyInCatalog = existingRows.length > 0;

    const result = await importVideoFromDirectSource(source.videoId);
    if (!result.videoId) {
      return NextResponse.json({ ok: false, error: "Invalid YouTube URL or video id." }, { status: 400 });
    }

    await applyMetadataHints(result.videoId, {
      artist: parsed.data.artist,
      track: parsed.data.track,
    }, true);

    const resolvedMetadata = await loadResolvedVideoMetadata(result.videoId, {
      artist: parsed.data.artist,
      track: parsed.data.track,
    });

    const parseConfidence = await loadVideoParseConfidence(result.videoId);
    const hasQualifiedMetadata =
      Boolean(resolvedMetadata.artist?.trim())
      && Boolean(resolvedMetadata.track?.trim())
      && parseConfidence !== null
      && parseConfidence >= PLAYBACK_MIN_CONFIDENCE;

    let submissionStatus: "ingested" | "already-in-catalog" | "rejected" = result.decision.allowed
      ? (alreadyInCatalog ? "already-in-catalog" : "ingested")
      : "rejected";

    let rejectionCode: string | null = submissionStatus === "rejected" ? result.decision.reason : null;
    let rejectionReason: string | null = submissionStatus === "rejected" ? getRejectionReason(result.decision) : null;

    // Suggest New confirmation should only report success when parsing quality is good.
    if (submissionStatus !== "rejected" && !hasQualifiedMetadata) {
      submissionStatus = "rejected";
      rejectionCode = parseConfidence === null || parseConfidence < PLAYBACK_MIN_CONFIDENCE ? "low-confidence" : "missing-metadata";
      rejectionReason =
        rejectionCode === "low-confidence"
          ? `Rejected: parsed metadata confidence is below required threshold (${PLAYBACK_MIN_CONFIDENCE}).`
          : "Rejected: parsed artist/track metadata is incomplete.";
    }

    return NextResponse.json({
      ok: true,
      kind: "video",
      videoId: result.videoId,
      submissionStatus,
      alreadyInCatalog,
      rejectionCode,
      rejectionReason,
      artist: submissionStatus === "rejected" ? null : resolvedMetadata.artist,
      track: submissionStatus === "rejected" ? null : resolvedMetadata.track,
      decision: result.decision,
    });
  }

  const playlist = await fetchPlaylistVideoIds(source.playlistId);
  if (!playlist.ok) {
    return NextResponse.json({ ok: false, error: playlist.error }, { status: 400 });
  }

  if (playlist.videoIds.length === 0) {
    return NextResponse.json({ ok: false, error: "No videos were found in that playlist." }, { status: 400 });
  }

  const jobKey = `${authResult.auth.userId}:${source.playlistId}`;
  const alreadyRunning = playlistBatchJobs.has(jobKey);
  startPlaylistBatchIngestion({
    jobKey,
    videoIds: playlist.videoIds,
    artist: parsed.data.artist,
    track: parsed.data.track,
  });

  return NextResponse.json({
    ok: true,
    kind: "playlist",
    playlistId: source.playlistId,
    queuedVideoCount: playlist.videoIds.length,
    background: true,
    jobAlreadyRunning: alreadyRunning,
  });
}
