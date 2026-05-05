import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildNormalizedVideoTitleFromMetadata,
  clearIngestionCachesForVideo,
  hasDatabaseUrl,
  importVideoFromDirectSource,
  normalizeYouTubeVideoId,
  pruneVideoAndAssociationsByVideoId,
} from "@/lib/catalog-data";
import { verifySameOrigin } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";
import { recordExternalApiUsage } from "@/lib/api-usage-telemetry";

const suggestSchema = z.object({
  source: z.string().trim().min(1).max(2048),
  artist: z.string().trim().max(255).optional(),
  track: z.string().trim().max(255).optional(),
  retryRejected: z.boolean().optional(),
});

const YOUTUBE_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || "";
const PLAYBACK_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.PLAYBACK_MIN_CONFIDENCE || "0.8")));
const SUGGEST_RELATED_DISCOVERY_SAMPLE_RATE = Math.max(
  0,
  Math.min(1, Number(process.env.SUGGEST_RELATED_DISCOVERY_SAMPLE_RATE || "0.08")),
);
const playlistBatchJobs = new Map<string, Promise<void>>();
const YOUTUBE_QUOTA_EXHAUSTED_TTL_MS = 26 * 60 * 60 * 1000;
let youtubeQuotaExhaustedUntilMs = 0;

type YouTubePlaylistFetchErrorCode = "youtube-read-failed" | "youtube-quota-exhausted";

function isYouTubeQuotaExhausted() {
  return youtubeQuotaExhaustedUntilMs > Date.now();
}

function markYouTubeQuotaExhaustedNow() {
  youtubeQuotaExhaustedUntilMs = Date.now() + YOUTUBE_QUOTA_EXHAUSTED_TTL_MS;
}

function isYouTubeQuotaErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const root = payload as {
    error?: {
      errors?: Array<{ reason?: string }>;
      status?: string;
      message?: string;
    };
  };

  const status = (root.error?.status ?? "").toString().toUpperCase();
  if (status === "RESOURCE_EXHAUSTED") {
    return true;
  }

  const message = (root.error?.message ?? "").toLowerCase();
  if (message.includes("quota") || message.includes("daily limit")) {
    return true;
  }

  const reasons = root.error?.errors ?? [];
  return reasons.some((entry) => {
    const reason = (entry.reason ?? "").toLowerCase();
    return reason === "quotaexceeded" || reason === "dailylimitexceeded" || reason === "ratelimitexceeded";
  });
}

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
    return { ok: false as const, error: "YouTube Data API key is not configured on the server.", code: "youtube-read-failed" as YouTubePlaylistFetchErrorCode };
  }

  if (isYouTubeQuotaExhausted()) {
    return {
      ok: false as const,
      error: "YouTube API credits are currently exhausted. Please try again later.",
      code: "youtube-quota-exhausted" as YouTubePlaylistFetchErrorCode,
    };
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
      const errorPayload = await response?.json().catch(() => null);
      const quotaExhausted = isYouTubeQuotaErrorPayload(errorPayload);
      if (quotaExhausted) {
        markYouTubeQuotaExhaustedNow();
      }

      void recordExternalApiUsage({
        provider: "youtube",
        endpoint: "playlistItems.list",
        units: 1,
        success: false,
        statusCode: response?.status ?? null,
        note: quotaExhausted ? "quota-exhausted" : "playlist-read-failed",
      });
      return {
        ok: false as const,
        error: quotaExhausted
          ? "YouTube API credits are currently exhausted. Please try again later."
          : "Could not read playlist from YouTube.",
        code: (quotaExhausted ? "youtube-quota-exhausted" : "youtube-read-failed") as YouTubePlaylistFetchErrorCode,
      };
    }

    void recordExternalApiUsage({
      provider: "youtube",
      endpoint: "playlistItems.list",
      units: 1,
      success: true,
      statusCode: response.status,
    });

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

function getNextYouTubeQuotaResetMs(): number {
  // YouTube quota resets at midnight Pacific Time (America/Los_Angeles)
  const now = new Date();
  const pacificNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  pacificNow.setDate(pacificNow.getDate() + 1);
  pacificNow.setHours(0, 0, 0, 0);
  const offsetMs = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).getTime();
  return pacificNow.getTime() + offsetMs;
}

export async function GET(request: NextRequest) {
  const quotaResetAtMs = getNextYouTubeQuotaResetMs();
  const msUntilReset = Math.max(0, quotaResetAtMs - Date.now());

  let todayUsageUnits: number | null = null;
  if (hasDatabaseUrl()) {
    try {
      const pacificDayStart = new Date(quotaResetAtMs - 24 * 60 * 60 * 1000);
      const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COALESCE(SUM(units), 0) AS total
        FROM external_api_usage_events
        WHERE provider = 'youtube'
          AND created_at >= ${pacificDayStart}
      `;
      todayUsageUnits = Number(rows[0]?.total ?? 0);
    } catch {
      // telemetry table may not exist yet — non-fatal
    }
  }

  return NextResponse.json({
    ok: true,
    quotaExhausted: isYouTubeQuotaExhausted(),
    quotaResetAt: new Date(quotaResetAtMs).toISOString(),
    msUntilReset,
    todayUsageUnits,
  });
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

  // Keep ingestion titles aligned with the normalized metadata naming convention.
  const rows = await prisma.$queryRaw<Array<{ title: string | null; parsedArtist: string | null; parsedTrack: string | null }>>`
    SELECT title, parsedArtist, parsedTrack
    FROM videos
    WHERE videoId = ${videoId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return;
  }

  const normalizedTitle = buildNormalizedVideoTitleFromMetadata(
    row.title,
    row.parsedArtist,
    row.parsedTrack,
  );

  if (!normalizedTitle) {
    return;
  }

  await prisma.$executeRaw`
    UPDATE videos
    SET title = ${normalizedTitle}
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
        const result = await importVideoFromDirectSource(videoId, { discoverRelated: false });
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
    const retryRejected = parsed.data.retryRejected === true;

    if (retryRejected && hasDatabaseUrl()) {
      clearIngestionCachesForVideo(source.videoId);

      await prisma.$executeRaw`
        DELETE FROM rejected_videos
        WHERE video_id = ${source.videoId}
      `;

      await pruneVideoAndAssociationsByVideoId(source.videoId, "suggest-retry-ingest-clear").catch(() => ({
        pruned: false,
        deletedVideoRows: 0,
        reason: "clear-failed",
      }));

      clearIngestionCachesForVideo(source.videoId);
    }

    const existingRows = !retryRejected && hasDatabaseUrl()
      ? await prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id
          FROM videos
          WHERE videoId = ${source.videoId}
          LIMIT 1
        `
      : [];
    const alreadyInCatalog = !retryRejected && existingRows.length > 0;

    // Re-enable occasional related discovery for fresh suggestions to keep discovery flowing,
    // while catalog-data quota guards preserve API headroom for ingest reliability.
    const discoverRelatedForSuggestion = retryRejected
      ? false
      : Math.random() < SUGGEST_RELATED_DISCOVERY_SAMPLE_RATE;
    const result = await importVideoFromDirectSource(source.videoId, { discoverRelated: discoverRelatedForSuggestion });
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
    const userProvidedArtist = parsed.data.artist?.trim() || null;
    const userProvidedTrack = parsed.data.track?.trim() || null;
    const userConfirmedMetadata = Boolean(userProvidedArtist && userProvidedTrack);
    const hasQualifiedMetadata =
      Boolean(resolvedMetadata.artist?.trim())
      && Boolean(resolvedMetadata.track?.trim())
      && parseConfidence !== null
      && parseConfidence >= PLAYBACK_MIN_CONFIDENCE;

    let submissionStatus: "ingested" | "already-in-catalog" | "rejected" | "needs-confirmation" = result.decision.allowed
      ? (alreadyInCatalog ? "already-in-catalog" : "ingested")
      : "rejected";

    let rejectionCode: string | null = submissionStatus === "rejected" ? result.decision.reason : null;
    let rejectionReason: string | null = submissionStatus === "rejected" ? getRejectionReason(result.decision) : null;

    // When metadata confidence is low but the video is otherwise playable and the user
    // hasn't already confirmed with explicit artist+track, ask them to confirm.
    // If the user already supplied both artist and track, treat their input as authoritative.
    if (submissionStatus !== "rejected" && !hasQualifiedMetadata && !userConfirmedMetadata) {
      const hasAnyGuess = Boolean(resolvedMetadata.artist?.trim() || resolvedMetadata.track?.trim());
      if (hasAnyGuess || result.decision.allowed) {
        // Return the AI's best guess for the user to correct and resubmit.
        return NextResponse.json({
          ok: true,
          kind: "video",
          videoId: result.videoId,
          submissionStatus: "needs-confirmation",
          alreadyInCatalog,
          suggestedArtist: resolvedMetadata.artist ?? null,
          suggestedTrack: resolvedMetadata.track ?? null,
          parseConfidence: parseConfidence ?? null,
          decision: result.decision,
        });
      }
      // No guess at all — hard reject as before.
      submissionStatus = "rejected";
      rejectionCode = parseConfidence === null || parseConfidence < PLAYBACK_MIN_CONFIDENCE ? "low-confidence" : "missing-metadata";
      rejectionReason =
        rejectionCode === "low-confidence"
          ? `Rejected: parsed metadata confidence is below required threshold (${PLAYBACK_MIN_CONFIDENCE}).`
          : "Rejected: parsed artist/track metadata is incomplete.";
    }

    // Hard reject if the video itself failed (unavailable, wrong type, etc.)
    // When userConfirmedMetadata is true we reach here — the user's hints are treated as
    // authoritative so no further rejection check is needed.

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
      relatedDiscoverySampled: discoverRelatedForSuggestion,
      decision: result.decision,
    });
  }

  const playlist = await fetchPlaylistVideoIds(source.playlistId);
  if (!playlist.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: playlist.error,
        errorCode: playlist.code,
      },
      { status: playlist.code === "youtube-quota-exhausted" ? 429 : 400 },
    );
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
