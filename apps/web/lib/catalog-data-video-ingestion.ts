/**
 * catalog-data-video-ingestion.ts
 * YouTube video ingestion, playback decisions, availability checks, related discovery,
 * metadata classification via Groq, and video pruning.
 */

import { prisma } from "@/lib/db";
import { recordExternalApiUsage } from "@/lib/api-usage-telemetry";
import { BoundedMap } from "@/lib/bounded-map";
import {
  buildNormalizedVideoTitleFromMetadata,
  computeArtistChannelConfidenceDelta,
  deriveAdminImportFallbackMetadata,
  normalizeParsedConfidence,
  normalizeParsedString,
  normalizePossiblyMojibakeText,
  scoreLikelyMojibake,
} from "@/lib/catalog-metadata-utils";
import {
  computeRelatedBackfillDelayMs,
  shouldScheduleRelatedBackfill,
} from "@/lib/related-backfill-scheduler";
import {
  debugCatalog,
  extractJsonObject,
  getYouTubeThumbnailUrl,
  hasDatabaseUrl,
  mapStoredVideoToPersistable,
  normalizeYouTubeVideoId,
  truncate,
  escapeSqlIdentifier,
  type ParsedVideoMetadata,
  type PersistableVideoRecord,
  type PlaybackDecision,
  type PlaybackDecisionRow,
} from "@/lib/catalog-data-utils";
import {
  ensureVideoChannelTitleColumnAvailable,
  ensureVideoMetadataColumnsAvailable,
  getStoredVideoById,
  loadTableColumns,
  loadVideoForeignKeyRefs,
  pickColumn,
} from "@/lib/catalog-data-db";
import {
  getArtistCatalogEvidence,
  scheduleArtistProjectionRefreshForName,
} from "@/lib/catalog-data-artists";
import { markAvailableVideoMaxIdDirty, recordAvailableVideoIdCandidate } from "@/lib/available-video-max-id";
import { clearGenreCardThumbnailForVideo } from "@/lib/catalog-data-genres";
import { getMusicBrainzArtistData } from "@/lib/musicbrainz";

// ── Constants ─────────────────────────────────────────────────────────────────

const AGE_RESTRICTED_PATTERNS = [
  /Sign in to confirm your age/i,
  /age[-\s]?restricted/i,
  /playerAgeGateRenderer/i,
  /desktopLegacyAgeGateReason/i,
  /"isFamilySafe"\s*:\s*false/i,
  /"status"\s*:\s*"AGE_CHECK_REQUIRED"/i,
  /"status"\s*:\s*"LOGIN_REQUIRED"[\s\S]{0,240}"reason"\s*:\s*"[^"]*age/i,
];

const BOT_CHALLENGE_PATTERNS = [
  /Sign in to (?:confirm|prove) you(?:'|\u2019)re not a bot/i,
  /prove you(?:'|\u2019)re not a bot/i,
  /"status"\s*:\s*"BOT_CHECK_REQUIRED"/i,
];

const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || undefined;
const ENABLE_YOUTUBE_RELATED_DISCOVERY = process.env.ENABLE_YOUTUBE_RELATED_DISCOVERY !== "0";
const YOUTUBE_DAILY_QUOTA_UNITS = Math.max(1_000, Number(process.env.YOUTUBE_DAILY_QUOTA_UNITS || "10000"));
const YOUTUBE_RELATED_DISCOVERY_RESERVED_UNITS = Math.max(0, Number(process.env.YOUTUBE_RELATED_DISCOVERY_RESERVED_UNITS || "2500"));
const YOUTUBE_RELATED_DISCOVERY_DAILY_BUDGET_UNITS = Math.max(100, Number(process.env.YOUTUBE_RELATED_DISCOVERY_DAILY_BUDGET_UNITS || "3000"));
const ENABLE_AUTO_RELATED_BACKFILL = process.env.ENABLE_AUTO_RELATED_BACKFILL !== "0";
const AUTO_RELATED_BACKFILL_UNITS_PER_RUN = Math.max(100, Math.min(3000, Number(process.env.AUTO_RELATED_BACKFILL_UNITS_PER_RUN || "300")));
const AUTO_RELATED_BACKFILL_MIN_INTERVAL_MS = Math.max(60_000, Number(process.env.AUTO_RELATED_BACKFILL_MIN_INTERVAL_MS || String(15 * 60 * 1000)));
const AUTO_RELATED_BACKFILL_MAX_NEWEST_OFFSET = Math.max(0, Math.min(500, Number(process.env.AUTO_RELATED_BACKFILL_MAX_NEWEST_OFFSET || "0")));
const AUTO_RELATED_BACKFILL_DEFER_MS = Math.max(0, Math.min(60_000, Number(process.env.AUTO_RELATED_BACKFILL_DEFER_MS || "5000")));
const AUTO_RELATED_BACKFILL_DEFER_JITTER_MS = Math.max(0, Math.min(60_000, Number(process.env.AUTO_RELATED_BACKFILL_DEFER_JITTER_MS || "5000")));
const RELATED_DISCOVERY_MAX_DEPTH = Math.max(1, Math.min(4, Number(process.env.RELATED_DISCOVERY_MAX_DEPTH || "2")));
const RELATED_DISCOVERY_MAX_NEW_VIDEOS = Math.max(1, Math.min(400, Number(process.env.RELATED_DISCOVERY_MAX_NEW_VIDEOS || "40")));
const RELATED_DISCOVERY_SEED_FANOUT = Math.max(1, Math.min(8, Number(process.env.RELATED_DISCOVERY_SEED_FANOUT || "8")));
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || undefined;
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
const GROQ_RETRY_COOLDOWN_MS = Math.max(300_000, Number(process.env.GROQ_RETRY_COOLDOWN_MS || String(6 * 60 * 60 * 1000)));
const PLAYBACK_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.PLAYBACK_MIN_CONFIDENCE || "0.8")));
const PLAYBACK_DECISION_CACHE_TTL_MS = 15_000;
const ALLOWED_VIDEO_TYPES = new Set(["official", "lyric", "live", "cover", "remix", "fan"]);
const NON_MUSIC_SIGNAL_PATTERN = /\b(instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|shorts?|sermon|khutbah|tafsir|quran|qur'an|recitation|dua|nasheed|bhajan|kirtan|pravachan|speech|lecture|talk show|news bulletin)\b/i;

const REJECTED_VIDEO_CACHE_TTL_MS = 5 * 60_000;
const BACKFILL_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.RELATED_BACKFILL_CONCURRENCY || "2")));
const INGESTION_CACHE_MAX_ENTRIES = Math.max(
  200,
  Math.min(5_000, Number(process.env.INGESTION_CACHE_MAX_ENTRIES || "2000")),
);

// ── Types ─────────────────────────────────────────────────────────────────────

type VideoAvailabilityStatus = "available" | "unavailable" | "check-failed";

type VideoAvailability = {
  status: VideoAvailabilityStatus;
  reason: string;
};

type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

type YouTubeRelatedSearchResponse = {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
};

type CachedPlaybackDecision = {
  expiresAt: number;
  decision: PlaybackDecision;
};

// ── Cache state ───────────────────────────────────────────────────────────────

const rejectedVideoCache = new BoundedMap<string, { expiresAt: number; rejected: boolean }>(INGESTION_CACHE_MAX_ENTRIES);
const playbackDecisionCache = new BoundedMap<string, CachedPlaybackDecision>(INGESTION_CACHE_MAX_ENTRIES);
const runtimeMetadataBackfillInFlight = new Set<number>();

let relatedDiscoveryQuotaSnapshot:
  | { dayKey: string; expiresAt: number; totalUnits: number; relatedUnits: number }
  | null = null;

let autoRelatedBackfillInFlight: Promise<void> | null = null;
let autoRelatedBackfillLastStartedAt = 0;
let autoRelatedBackfillTimer: ReturnType<typeof setTimeout> | null = null;
let autoRelatedBackfillScheduledFor = 0;

/**
 * Registered by the barrel so that pruneVideoAndAssociationsByVideoId can trigger
 * a full multi-module cache clear without creating a circular dependency.
 */
let _fullCacheInvalidator: (() => void) | undefined;

export function registerFullCacheInvalidator(fn: () => void) {
  _fullCacheInvalidator = fn;
}

export function clearIngestionCaches() {
  rejectedVideoCache.clear();
  playbackDecisionCache.clear();
  relatedDiscoveryQuotaSnapshot = null;
  if (autoRelatedBackfillTimer) {
    clearTimeout(autoRelatedBackfillTimer);
    autoRelatedBackfillTimer = null;
    autoRelatedBackfillScheduledFor = 0;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPacificDayWindow(now = new Date()) {
  const pacificDateKey = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const pacificNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const pacificDayStart = new Date(pacificNow);
  pacificDayStart.setHours(0, 0, 0, 0);
  const pacificNowCopy = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offsetMs = now.getTime() - pacificNowCopy.getTime();

  return {
    dayKey: pacificDateKey,
    dayStartUtc: new Date(pacificDayStart.getTime() + offsetMs),
  };
}

async function canSpendRelatedDiscoveryUnits(units: number) {
  if (!hasDatabaseUrl()) return true;

  const safeUnits = Math.max(0, Math.floor(units));
  if (safeUnits <= 0) return true;

  const now = Date.now();
  const { dayKey, dayStartUtc } = getPacificDayWindow(new Date(now));

  if (
    !relatedDiscoveryQuotaSnapshot ||
    relatedDiscoveryQuotaSnapshot.dayKey !== dayKey ||
    relatedDiscoveryQuotaSnapshot.expiresAt <= now
  ) {
    try {
      const [totalRows, relatedRows] = await Promise.all([
        prisma.$queryRaw<Array<{ total: bigint }>>`
          SELECT COALESCE(SUM(units), 0) AS total
          FROM external_api_usage_events
          WHERE provider = 'youtube' AND created_at >= ${dayStartUtc}
        `,
        prisma.$queryRaw<Array<{ total: bigint }>>`
          SELECT COALESCE(SUM(units), 0) AS total
          FROM external_api_usage_events
          WHERE provider = 'youtube'
            AND endpoint = 'search.list.query'
            AND created_at >= ${dayStartUtc}
        `,
      ]);

      relatedDiscoveryQuotaSnapshot = {
        dayKey,
        expiresAt: now + 60_000,
        totalUnits: Number(totalRows[0]?.total ?? 0),
        relatedUnits: Number(relatedRows[0]?.total ?? 0),
      };
    } catch {
      return true;
    }
  }

  const snapshot = relatedDiscoveryQuotaSnapshot;
  if (!snapshot) return true;

  const totalBudget = Math.max(0, YOUTUBE_DAILY_QUOTA_UNITS - YOUTUBE_RELATED_DISCOVERY_RESERVED_UNITS);
  const reserveGuardAllows = snapshot.totalUnits + safeUnits <= totalBudget;
  const relatedBudgetAllows = snapshot.relatedUnits + safeUnits <= YOUTUBE_RELATED_DISCOVERY_DAILY_BUDGET_UNITS;
  const allowed = reserveGuardAllows && relatedBudgetAllows;

  if (!allowed) {
    debugCatalog("fetchRelatedYouTubeVideos:quota-guard-blocked", {
      requestedUnits: safeUnits,
      totalUnits: snapshot.totalUnits,
      relatedUnits: snapshot.relatedUnits,
      dailyQuota: YOUTUBE_DAILY_QUOTA_UNITS,
      reservedUnits: YOUTUBE_RELATED_DISCOVERY_RESERVED_UNITS,
      relatedDailyBudget: YOUTUBE_RELATED_DISCOVERY_DAILY_BUDGET_UNITS,
    });
  }

  return allowed;
}

/**
 * Immediately update the in-memory quota snapshot to reflect units just spent,
 * so rapid follow-on calls within the 60-second TTL window see an accurate
 * remaining budget rather than the stale pre-spend figure.
 */
function recordSpentRelatedDiscoveryUnits(units: number) {
  if (!relatedDiscoveryQuotaSnapshot) return;
  relatedDiscoveryQuotaSnapshot = {
    ...relatedDiscoveryQuotaSnapshot,
    totalUnits: relatedDiscoveryQuotaSnapshot.totalUnits + units,
    relatedUnits: relatedDiscoveryQuotaSnapshot.relatedUnits + units,
  };
}

function containsAgeRestrictionMarker(html: string) {
  return AGE_RESTRICTED_PATTERNS.some((pattern) => pattern.test(html));
}

function containsBotChallengeMarker(html: string) {
  return BOT_CHALLENGE_PATTERNS.some((pattern) => pattern.test(html));
}

function extractPlayabilityStatus(html: string) {
  const statusMatch = html.match(/"playabilityStatus"\s*:\s*\{[\s\S]{0,800}?"status"\s*:\s*"([A-Z_]+)"([\s\S]{0,1200}?)\}/i);
  if (!statusMatch) return null;

  const status = statusMatch[1]?.trim().toUpperCase() ?? "";
  const chunk = statusMatch[2] ?? "";
  const reasonMatch = chunk.match(/"reason"\s*:\s*"([^"]+)"/i);
  const reason = reasonMatch?.[1]?.trim() ?? null;
  return { status, reason };
}

function isUnavailablePlayabilityReason(reason: string | null | undefined) {
  return (
    typeof reason === "string" &&
    /(video unavailable|private video|deleted|removed|copyright|terminated|not available|this video is unavailable)/i.test(reason)
  );
}

function isLikelyNonMusicText(title: string, description: string) {
  const haystack = `${title}\n${description}`;
  return NON_MUSIC_SIGNAL_PATTERN.test(haystack);
}

function isLikelyNonMusicSignal(row: PlaybackDecisionRow) {
  return isLikelyNonMusicText(row.title, row.description ?? "");
}

export function evaluatePlaybackMetadataEligibility(row: PlaybackDecisionRow): PlaybackDecision {
  const artist = row.parsedArtist?.trim() ?? "";
  const track = row.parsedTrack?.trim() ?? "";
  const videoType = (row.parsedVideoType ?? "").trim().toLowerCase();
  const confidence = Number(row.parseConfidence ?? NaN);

  if (!artist || !track) {
    return { allowed: false, reason: "missing-metadata", message: "Sorry, that video cannot be played on YehThatRocks." };
  }

  if (!ALLOWED_VIDEO_TYPES.has(videoType)) {
    return { allowed: false, reason: "unknown-video-type", message: "Sorry, that video cannot be played on YehThatRocks." };
  }

  if (!Number.isFinite(confidence) || confidence < PLAYBACK_MIN_CONFIDENCE) {
    return { allowed: false, reason: "low-confidence", message: "Sorry, that video cannot be played on YehThatRocks." };
  }

  if (isLikelyNonMusicSignal(row) && confidence < 0.9) {
    return { allowed: false, reason: "low-confidence", message: "Sorry, that video cannot be played on YehThatRocks." };
  }

  return { allowed: true, reason: "ok" };
}

// ── Rejected video cache ──────────────────────────────────────────────────────

async function isRejectedVideo(videoId: string): Promise<boolean> {
  if (!hasDatabaseUrl()) return false;

  const cached = rejectedVideoCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.rejected;

  try {
    const rows = await prisma.$queryRaw<Array<{ video_id: string }>>`
      SELECT video_id FROM rejected_videos WHERE video_id = ${videoId} LIMIT 1
    `;
    const rejected = rows.length > 0;
    rejectedVideoCache.set(videoId, { expiresAt: Date.now() + REJECTED_VIDEO_CACHE_TTL_MS, rejected });
    return rejected;
  } catch {
    return false;
  }
}

async function persistRejectedVideo(videoId: string, reason: string): Promise<void> {
  if (!hasDatabaseUrl()) return;

  try {
    await prisma.$executeRaw`
      INSERT INTO rejected_videos (video_id, reason, rejected_at)
      VALUES (${videoId}, ${reason}, ${new Date()})
      ON DUPLICATE KEY UPDATE reason = VALUES(reason), rejected_at = VALUES(rejected_at)
    `;
    rejectedVideoCache.set(videoId, { expiresAt: Date.now() + REJECTED_VIDEO_CACHE_TTL_MS, rejected: true });
  } catch {
    // best-effort
  }
}

// ── Embed playability check ───────────────────────────────────────────────────

async function checkEmbedPlayability(videoId: string): Promise<VideoAvailability> {
  try {
    const response = await fetch(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`, {
      headers: { "User-Agent": "YehThatRocks/1.0" },
    });

    if (!response.ok) {
      if ([404, 410].includes(response.status)) {
        return { status: "unavailable", reason: `embed:${response.status}` };
      }
      if ([401, 403].includes(response.status)) {
        return { status: "check-failed", reason: `embed:provider-blocked-${response.status}` };
      }
      return { status: "check-failed", reason: `embed:${response.status}` };
    }

    const html = await response.text();
    const playability = extractPlayabilityStatus(html);

    if (containsBotChallengeMarker(html)) return { status: "check-failed", reason: "embed:bot-check" };
    if (containsAgeRestrictionMarker(html)) return { status: "unavailable", reason: "embed:age-restricted" };

    if (playability?.status === "LOGIN_REQUIRED" || playability?.status === "CONTENT_CHECK_REQUIRED") {
      if (isUnavailablePlayabilityReason(playability.reason)) {
        return { status: "unavailable", reason: "embed:playability-login-unavailable" };
      }
      return { status: "check-failed", reason: "embed:interactive-login-check" };
    }

    if (playability && /^(ERROR|UNPLAYABLE|AGE_CHECK_REQUIRED)$/i.test(playability.status)) {
      return { status: "unavailable", reason: "embed:playability-unavailable" };
    }

    if (/"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"OK"/i.test(html)) {
      return { status: "available", reason: "embed:playability-ok" };
    }

    if (/video unavailable/i.test(html)) {
      return { status: "unavailable", reason: "embed:video-unavailable" };
    }

    return { status: "available", reason: "embed:accessible-no-markers" };
  } catch (error) {
    return {
      status: "check-failed",
      reason: `embed-network:${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

// ── oEmbed fetch ──────────────────────────────────────────────────────────────

async function fetchOEmbedVideo(videoId: string): Promise<PersistableVideoRecord | null> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId) return null;

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${normalizedVideoId}`)}&format=json`,
      { headers: { "User-Agent": "YehThatRocks/1.0" } },
    );

    if (!response.ok) {
      debugCatalog("fetchOEmbedVideo:response-not-ok", { videoId: normalizedVideoId, status: response.status });
      return null;
    }

    const data = (await response.json()) as YouTubeOEmbedResponse;
    const title = data.title?.trim() ? normalizePossiblyMojibakeText(data.title) : "";
    const channelTitle = data.author_name?.trim() ? normalizePossiblyMojibakeText(data.author_name) : "";

    if (!title) {
      debugCatalog("fetchOEmbedVideo:missing-title", { videoId: normalizedVideoId });
      return null;
    }

    return {
      id: normalizedVideoId,
      title,
      channelTitle: channelTitle || "YouTube",
      genre: "Rock / Metal",
      favourited: 0,
      description: "Direct YouTube link loaded outside the local catalog.",
      thumbnail: data.thumbnail_url?.trim() || getYouTubeThumbnailUrl(normalizedVideoId),
    };
  } catch {
    debugCatalog("fetchOEmbedVideo:error", { videoId: normalizedVideoId });
    return null;
  }
}

// ── Groq metadata classification ──────────────────────────────────────────────

function buildGroqMetadataPrompt(video: PersistableVideoRecord) {
  const descriptionSnippet = truncate(video.description ?? "", 700);
  return [
    "Extract music metadata from this YouTube video record.",
    "Return JSON only with keys:",
    '{"artist":string|null,"track":string|null,"videoType":"official"|"lyric"|"live"|"cover"|"remix"|"fan"|"unknown","confidence":number,"reason":string}',
    "Rules:",
    "- YehThatRocks is a rock/metal catalog. If this is clearly non-rock/non-metal or non-music, return artist=null, track=null, confidence<=0.4 and explain why.",
    "- artist must be the performing artist/band.",
    "- track must be song title only.",
    "- Do not include venue, city, date, official video, remaster, lyrics, HD in artist or track.",
    "- If ambiguous, use null and lower confidence.",
    "",
    `videoId: ${video.id}`,
    `rawTitle: ${video.title}`,
    `descriptionSnippet: ${descriptionSnippet}`,
  ].join("\n");
}

async function classifyVideoMetadataWithGroq(video: PersistableVideoRecord): Promise<ParsedVideoMetadata | null> {
  if (!GROQ_API_KEY) return null;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a strict music metadata extraction service. Output valid JSON only, with no markdown fences.",
          },
          { role: "user", content: buildGroqMetadataPrompt(video) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      void recordExternalApiUsage({
        provider: "groq",
        endpoint: "chat/completions",
        units: 1,
        success: false,
        statusCode: response.status,
        note: body.slice(0, 120) || null,
      });
      throw new Error(`Groq API error ${response.status}: ${body.slice(0, 260)}`);
    }

    void recordExternalApiUsage({
      provider: "groq",
      endpoint: "chat/completions",
      units: 1,
      success: true,
      statusCode: response.status,
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = extractJsonObject(payload?.choices?.[0]?.message?.content);

    return {
      artist: normalizeParsedString(parsed.artist, 255),
      track: normalizeParsedString(parsed.track, 255),
      videoType: normalizeParsedString(parsed.videoType, 50),
      confidence: normalizeParsedConfidence(parsed.confidence),
      reason: normalizeParsedString(parsed.reason, 500),
    };
  } catch (error) {
    void recordExternalApiUsage({
      provider: "groq",
      endpoint: "chat/completions",
      units: 1,
      success: false,
      statusCode: null,
      note: error instanceof Error ? error.message.slice(0, 120) : "request-error",
    });
    debugCatalog("classifyVideoMetadataWithGroq:error", {
      videoId: video.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ── Runtime metadata persistence ──────────────────────────────────────────────

async function maybePersistRuntimeMetadata(videoRowId: number, video: PersistableVideoRecord) {
  if (!GROQ_API_KEY) return;

  const hasColumns = await ensureVideoMetadataColumnsAvailable();
  if (!hasColumns) return;

  try {
    const existing = await prisma.$queryRaw<
      Array<{
        title: string | null;
        parsedArtist: string | null;
        parsedTrack: string | null;
        parsedVideoType: string | null;
        parseConfidence: number | null;
        parseMethod: string | null;
        parsedAt: Date | null;
      }>
    >`
      SELECT title, parsedArtist, parsedTrack, parsedVideoType, parseConfidence, parseMethod, parsedAt
      FROM videos WHERE id = ${videoRowId} LIMIT 1
    `;

    const existingMeta = existing[0];
    const existingConfidence = Number(existingMeta?.parseConfidence ?? NaN);
    const existingVideoType = (existingMeta?.parsedVideoType ?? "").trim().toLowerCase();
    const hasSufficientMetadata =
      Boolean(existingMeta?.parsedArtist?.trim()) &&
      Boolean(existingMeta?.parsedTrack?.trim()) &&
      ALLOWED_VIDEO_TYPES.has(existingVideoType) &&
      Number.isFinite(existingConfidence) &&
      existingConfidence >= PLAYBACK_MIN_CONFIDENCE;

    if (hasSufficientMetadata) {
      if (existingMeta?.parsedArtist?.trim()) {
        scheduleArtistProjectionRefreshForName(existingMeta.parsedArtist);
      }
      return;
    }

    const parsedAtRaw = existingMeta?.parsedAt;
    const parsedAtMs = parsedAtRaw
      ? parsedAtRaw instanceof Date ? parsedAtRaw.getTime() : new Date(parsedAtRaw).getTime()
      : NaN;
    const hasRecentGroqAttempt =
      Number.isFinite(parsedAtMs) &&
      Date.now() - parsedAtMs < GROQ_RETRY_COOLDOWN_MS &&
      (existingMeta?.parseMethod === "groq-error" || (existingMeta?.parseMethod ?? "").startsWith("groq-llm"));

    if (hasRecentGroqAttempt) return;

    const parsed = await classifyVideoMetadataWithGroq(video);
    if (!parsed) {
      await prisma.$executeRaw`
        UPDATE videos
        SET parseMethod = ${"groq-error"},
            parseReason = ${"Groq metadata classification failed. Retry deferred by cooldown."},
            parsedAt = ${new Date()}
        WHERE id = ${videoRowId}
      `;
      return;
    }

    const correctedArtist = parsed.artist;
    const correctedTrack = parsed.track;
    const [artistEvidence, mbData] = await Promise.all([
      correctedArtist
        ? getArtistCatalogEvidence(correctedArtist)
        : Promise.resolve({ known: false, rockOrMetalGenreMatch: false }),
      correctedArtist
        ? getMusicBrainzArtistData(correctedArtist)
        : Promise.resolve(null),
    ]);

    const confidenceNotes: string[] = [];
    let adjustedConfidence = Number(parsed.confidence ?? 0);

    if (artistEvidence.known) {
      adjustedConfidence = Math.max(adjustedConfidence, 0.88);
      confidenceNotes.push("Artist matched known artists catalog.");
      if (!artistEvidence.rockOrMetalGenreMatch) {
        adjustedConfidence = Math.min(adjustedConfidence, 0.74);
        confidenceNotes.push("Known artist lacks strong rock/metal genre evidence.");
      }
    }

    if (mbData) {
      if (mbData.isRockOrMetal) {
        adjustedConfidence = Math.max(adjustedConfidence, 0.85);
        const tagHint = mbData.disambiguation || mbData.tags.slice(0, 3).join(", ");
        confidenceNotes.push(`MusicBrainz confirmed rock/metal: ${tagHint || "genre match"}.`);
      } else if (mbData.isDefinitelyNotRockOrMetal) {
        adjustedConfidence = Math.min(adjustedConfidence, 0.68);
        const tagHint = mbData.disambiguation || mbData.tags.slice(0, 2).join(", ");
        confidenceNotes.push(`MusicBrainz genre mismatch (non-rock/metal): ${tagHint || "non-rock genre"}.`);
      }
    }

    const channelDelta = computeArtistChannelConfidenceDelta(correctedArtist, video.channelTitle);
    if (channelDelta > 0) {
      adjustedConfidence += channelDelta;
      confidenceNotes.push("Artist token matched channel title.");
    } else if (channelDelta < 0) {
      adjustedConfidence += channelDelta;
      confidenceNotes.push("Channel title did not match parsed artist.");
    }

    if (isLikelyNonMusicText(video.title, video.description ?? "")) {
      adjustedConfidence = Math.min(adjustedConfidence, 0.72);
      confidenceNotes.push("Title/description include non-music indicators.");
    }

    const mojibakeScore = scoreLikelyMojibake(video.title);
    if (mojibakeScore >= 8) {
      adjustedConfidence = Math.min(adjustedConfidence, 0.76);
      confidenceNotes.push("Title appears strongly mojibake-corrupted.");
    }

    adjustedConfidence = Math.max(0, Math.min(1, adjustedConfidence));
    const correctedReason = [parsed.reason, ...confidenceNotes].filter(Boolean).join(" | ");
    const existingTitle = normalizeParsedString(existingMeta?.title, 255) ?? truncate(video.title, 255);
    const nextPersistedTitle =
      Number.isFinite(adjustedConfidence) && adjustedConfidence >= PLAYBACK_MIN_CONFIDENCE
        ? (buildNormalizedVideoTitleFromMetadata(existingTitle, correctedArtist, correctedTrack) ?? existingTitle)
        : existingTitle;

    await prisma.$executeRaw`
      UPDATE videos
      SET title = ${nextPersistedTitle},
          parsedArtist = ${correctedArtist},
          parsedTrack = ${correctedTrack},
          parsedVideoType = ${parsed.videoType},
          parseMethod = ${"groq-llm"},
          parseReason = ${correctedReason},
          parseConfidence = ${adjustedConfidence},
          parsedAt = ${new Date()}
      WHERE id = ${videoRowId}
    `;

    debugCatalog("maybePersistRuntimeMetadata:updated", {
      videoId: video.id,
      rowId: videoRowId,
      title: nextPersistedTitle,
      artist: correctedArtist,
      track: correctedTrack,
      confidence: adjustedConfidence,
    });

    if (correctedArtist) {
      scheduleArtistProjectionRefreshForName(correctedArtist);
    }
  } catch (error) {
    debugCatalog("maybePersistRuntimeMetadata:error", {
      videoId: video.id,
      rowId: videoRowId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function triggerRuntimeMetadataBackfill(videoRowId: number, video: PersistableVideoRecord) {
  if (runtimeMetadataBackfillInFlight.has(videoRowId)) return;

  runtimeMetadataBackfillInFlight.add(videoRowId);
  void maybePersistRuntimeMetadata(videoRowId, video)
    .catch(() => undefined)
    .finally(() => {
      runtimeMetadataBackfillInFlight.delete(videoRowId);
    });
}

// ── Video availability persistence ────────────────────────────────────────────

async function persistVideoAvailability(video: PersistableVideoRecord, availability: VideoAvailability) {
  const persistedTitle = truncate(normalizePossiblyMojibakeText(video.title), 255);
  const persistedDescription = video.description;

  if (availability.status === "unavailable") {
    await persistRejectedVideo(video.id, availability.reason || "unavailable");
    debugCatalog("persistVideoAvailability:rejected", { videoId: video.id, reason: availability.reason });
    return null;
  }

  const GENERIC_CHANNEL_FALLBACKS = new Set(["unknown artist", "youtube", "unknown"]);
  const rawChannelTitle = normalizePossiblyMojibakeText(video.channelTitle?.trim() ?? "");
  const persistedChannelTitle =
    rawChannelTitle && !GENERIC_CHANNEL_FALLBACKS.has(rawChannelTitle.toLowerCase())
      ? truncate(rawChannelTitle, 255)
      : null;
  const persistedTimestamp = new Date();
  const hasChannelTitleColumn = await ensureVideoChannelTitleColumnAvailable();
  const existingVideo = await getStoredVideoById(video.id);

  if (hasChannelTitleColumn) {
    await prisma.$executeRaw`
      INSERT INTO videos (videoId, title, channelTitle, favourited, description, created_at, updated_at)
      VALUES (${video.id}, ${persistedTitle}, ${persistedChannelTitle}, 0, ${persistedDescription}, ${persistedTimestamp}, ${persistedTimestamp})
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        channelTitle = VALUES(channelTitle),
        description = VALUES(description),
        updated_at = VALUES(updated_at)
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO videos (videoId, title, favourited, description, created_at, updated_at)
      VALUES (${video.id}, ${persistedTitle}, 0, ${persistedDescription}, ${persistedTimestamp}, ${persistedTimestamp})
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        description = VALUES(description),
        updated_at = VALUES(updated_at)
    `;
  }

  debugCatalog("persistVideoAvailability:video-upserted", {
    videoId: video.id,
    hadExistingVideo: Boolean(existingVideo),
    availabilityStatus: availability.status,
  });

  const persistedVideo = await getStoredVideoById(video.id, { includeUnapproved: true });
  if (!persistedVideo) throw new Error(`Failed to persist video ${video.id}`);

  const existingSiteVideo = await prisma.siteVideo.findFirst({
    where: { videoId: persistedVideo.id },
    select: { id: true },
  });

  const titleWithReason = truncate(`${persistedTitle} [${availability.reason}]`, 255);

  if (existingSiteVideo) {
    await prisma.siteVideo.update({
      where: { id: existingSiteVideo.id },
      data: { title: titleWithReason, status: availability.status },
    });
  } else {
    await prisma.siteVideo.create({
      data: { videoId: persistedVideo.id, title: titleWithReason, status: availability.status, createdAt: new Date() },
    });
  }

  debugCatalog("persistVideoAvailability:site-video-updated", {
    videoId: video.id,
    hadExistingSiteVideo: Boolean(existingSiteVideo),
    status: availability.status,
  });

  if (availability.status !== "available") {
    await clearGenreCardThumbnailForVideo(video.id);
  }

  if (availability.status === "available") {
    void recordAvailableVideoIdCandidate(persistedVideo.id).catch(() => undefined);
  } else {
    void markAvailableVideoMaxIdDirty().catch(() => undefined);
  }

  await maybePersistRuntimeMetadata(persistedVideo.id, video);
  return persistedVideo;
}

// ── Related cache ─────────────────────────────────────────────────────────────

async function persistRelatedVideoCache(videoId: string, relatedIds: string[]) {
  const persistedRelatedIds = Array.from(new Set(relatedIds.filter(Boolean)));
  const effectiveRelatedIds = persistedRelatedIds.length > 0 ? persistedRelatedIds : [videoId];
  const now = new Date();

  await prisma.relatedCache.deleteMany({ where: { videoId } });
  await prisma.relatedCache.createMany({
    data: effectiveRelatedIds.map((relatedId) => ({
      videoId,
      related: relatedId,
      createdAt: now,
      updatedAt: now,
    })),
  });

  const reverseCandidateIds = effectiveRelatedIds.filter((id) => id !== videoId);
  if (reverseCandidateIds.length === 0) return;

  const existingVideos = await prisma.video.findMany({
    where: { videoId: { in: reverseCandidateIds } },
    select: { videoId: true },
  });

  if (existingVideos.length === 0) return;

  const existingVideoIds = existingVideos.map((v) => v.videoId).filter((id): id is string => Boolean(id));
  if (existingVideoIds.length === 0) return;

  const alreadyLinkedBack = await prisma.relatedCache.findMany({
    where: { videoId: { in: existingVideoIds }, related: videoId },
    select: { videoId: true },
  });

  const linkedBackSet = new Set(alreadyLinkedBack.map((row) => row.videoId).filter(Boolean));
  const reverseLinksToCreate = existingVideoIds
    .filter((id) => !linkedBackSet.has(id))
    .map((id) => ({ videoId: id, related: videoId, createdAt: now, updatedAt: now }));

  if (reverseLinksToCreate.length > 0) {
    await prisma.relatedCache.createMany({ data: reverseLinksToCreate });
  }
}

async function hasStoredRelatedCache(videoId: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId || !hasDatabaseUrl()) return false;

  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count FROM related WHERE videoId = ${normalizedVideoId}
  `;
  const countValue = rows[0]?.count;
  const count = typeof countValue === "bigint" ? Number(countValue) : Number(countValue ?? 0);
  return count > 0;
}

// ── YouTube API ───────────────────────────────────────────────────────────────

async function fetchRelatedYouTubeVideos(videoId: string): Promise<PersistableVideoRecord[]> {
  if (!ENABLE_YOUTUBE_RELATED_DISCOVERY) {
    debugCatalog("fetchRelatedYouTubeVideos:disabled", { videoId });
    return [];
  }

  if (!YOUTUBE_DATA_API_KEY) {
    debugCatalog("fetchRelatedYouTubeVideos:skipped-missing-api-key", { videoId });
    return [];
  }

  if (!(await canSpendRelatedDiscoveryUnits(100))) return [];

  try {
    const seedRows = await prisma.$queryRaw<Array<{
      title: string | null;
      parsedArtist: string | null;
      parsedTrack: string | null;
    }>>`
      SELECT v.title, v.parsedArtist, v.parsedTrack
      FROM videos v WHERE v.videoId = ${videoId}
      ORDER BY v.created_at DESC, v.id DESC LIMIT 1
    `;

    const seed = seedRows[0];
    const query = [seed?.parsedArtist?.trim() || "", seed?.parsedTrack?.trim() || "", seed?.title?.trim() || ""]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);

    if (!query) {
      debugCatalog("fetchRelatedYouTubeVideos:skipped-empty-query", { videoId });
      return [];
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("maxResults", "8");
    url.searchParams.set("type", "video");
    url.searchParams.set("q", query);
    url.searchParams.set("key", YOUTUBE_DATA_API_KEY);

    const response = await fetch(url, { headers: { "User-Agent": "YehThatRocks/1.0" } });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      void recordExternalApiUsage({
        provider: "youtube",
        endpoint: "search.list.query",
        units: 100,
        success: false,
        statusCode: response.status,
        note: body.slice(0, 120) || null,
      });
      // Count failed requests against the budget too — the quota is consumed
      // regardless of whether YouTube returns a valid result.
      recordSpentRelatedDiscoveryUnits(100);
      debugCatalog("fetchRelatedYouTubeVideos:query-response-not-ok", { videoId, query, status: response.status });
      return [];
    }

    void recordExternalApiUsage({ provider: "youtube", endpoint: "search.list.query", units: 100, success: true, statusCode: response.status });
      recordSpentRelatedDiscoveryUnits(100);
    const data = (await response.json()) as YouTubeRelatedSearchResponse;

    const mapped = (data.items ?? [])
      .map((item) => {
        const relatedId = normalizeYouTubeVideoId(item.id?.videoId);
        const title = item.snippet?.title?.trim() ? normalizePossiblyMojibakeText(item.snippet.title) : "";
        if (!relatedId || !title || relatedId === videoId) return null;

        return {
          id: relatedId,
          title,
          channelTitle: item.snippet?.channelTitle?.trim()
            ? normalizePossiblyMojibakeText(item.snippet.channelTitle)
            : "YouTube",
          genre: "Rock / Metal",
          favourited: 0,
          description: item.snippet?.description?.trim() || "Related YouTube video discovered via YouTube Data API search query.",
          thumbnail:
            item.snippet?.thumbnails?.high?.url?.trim() ||
            item.snippet?.thumbnails?.medium?.url?.trim() ||
            item.snippet?.thumbnails?.default?.url?.trim() ||
            getYouTubeThumbnailUrl(relatedId),
        } satisfies PersistableVideoRecord;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    debugCatalog("fetchRelatedYouTubeVideos:query-success", { videoId, query, relatedCount: mapped.length });
    return mapped;
  } catch (error) {
    void recordExternalApiUsage({
      provider: "youtube",
      endpoint: "search.list.query",
      units: 100,
      success: false,
      statusCode: null,
      note: error instanceof Error ? error.message.slice(0, 120) : "request-error",
    });
    recordSpentRelatedDiscoveryUnits(100);
    debugCatalog("fetchRelatedYouTubeVideos:query-error", {
      videoId,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function getExistingCatalogVideoIdSet(videoIds: string[]) {
  const normalizedIds = Array.from(
    new Set(videoIds.map((id) => normalizeYouTubeVideoId(id)).filter((id): id is string => Boolean(id))),
  );
  if (normalizedIds.length === 0 || !hasDatabaseUrl()) return new Set<string>();

  const [videoRows, rejectedRows] = await Promise.all([
    prisma.video.findMany({ where: { videoId: { in: normalizedIds } }, select: { videoId: true } }),
    (async () => {
      try {
        const placeholders = normalizedIds.map(() => "?").join(", ");
        return await prisma.$queryRawUnsafe<Array<{ video_id: string }>>(
          `SELECT video_id FROM rejected_videos WHERE video_id IN (${placeholders})`,
          ...normalizedIds,
        );
      } catch {
        return [] as Array<{ video_id: string }>;
      }
    })(),
  ]);

  return new Set<string>([
    ...videoRows.map((row) => row.videoId).filter((id): id is string => Boolean(id)),
    ...rejectedRows.map((row) => row.video_id),
  ]);
}

async function canAdmitVideoByStrictMetadata(videoId: string) {
  const admissionRows = await prisma.$queryRaw<Array<PlaybackDecisionRow>>`
    SELECT
      v.id, v.title, v.description, v.parsedArtist, v.parsedTrack, v.parsedVideoType, v.parseConfidence,
      EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available') AS hasAvailable,
      EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status <> 'available')) AS hasBlocked
    FROM videos v
    WHERE v.videoId = ${videoId}
    ORDER BY v.updated_at DESC, v.id DESC LIMIT 1
  `;

  const admissionRow = admissionRows[0];
  const admissionDecision = admissionRow ? evaluatePlaybackMetadataEligibility(admissionRow) : null;
  return Boolean(admissionRow && admissionRow.hasAvailable && admissionDecision?.allowed);
}

function getRelatedFanoutForDepth(depth: number) {
  const value = Math.floor(RELATED_DISCOVERY_SEED_FANOUT * Math.pow(0.5, depth));
  return Math.max(1, Math.min(8, value));
}

// ── Hydration ─────────────────────────────────────────────────────────────────

async function hydrateAndPersistVideo(
  videoId: string,
  providedVideo?: PersistableVideoRecord,
  options?: { forceAvailabilityRefresh?: boolean; skipRelatedDiscovery?: boolean },
): Promise<PersistableVideoRecord | null> {
  if (!hasDatabaseUrl()) return providedVideo ?? (await fetchOEmbedVideo(videoId));

  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId) {
    debugCatalog("hydrateAndPersistVideo:invalid-video-id", { videoId });
    return null;
  }

  if (await isRejectedVideo(normalizedVideoId)) {
    debugCatalog("hydrateAndPersistVideo:rejected-skip", { videoId: normalizedVideoId });
    return null;
  }

  // Include unapproved rows so that pending-review videos don't trigger redundant re-hydration.
  const existingVideo = await getStoredVideoById(normalizedVideoId, { includeUnapproved: true });
  if (existingVideo && !options?.forceAvailabilityRefresh) {
    debugCatalog("hydrateAndPersistVideo:local-hit", { videoId: normalizedVideoId });
    return mapStoredVideoToPersistable(existingVideo);
  }

  debugCatalog("hydrateAndPersistVideo:hydrate", {
    videoId: normalizedVideoId,
    hasExistingVideo: Boolean(existingVideo),
    forceAvailabilityRefresh: Boolean(options?.forceAvailabilityRefresh),
  });

  const video =
    providedVideo ??
    (existingVideo ? mapStoredVideoToPersistable(existingVideo) : await fetchOEmbedVideo(normalizedVideoId));

  if (!video) {
    debugCatalog("hydrateAndPersistVideo:no-external-video", { videoId: normalizedVideoId });
    return null;
  }

  const availability = await checkEmbedPlayability(normalizedVideoId);
  debugCatalog("hydrateAndPersistVideo:availability", {
    videoId: normalizedVideoId,
    status: availability.status,
    reason: availability.reason,
  });

  const persisted = await persistVideoAvailability(video, availability);
  if (!persisted) return null;

  if (
    availability.status !== "unavailable" &&
    ENABLE_YOUTUBE_RELATED_DISCOVERY &&
    !options?.skipRelatedDiscovery &&
    !(await hasStoredRelatedCache(normalizedVideoId))
  ) {
    const relatedVideos = await fetchRelatedYouTubeVideos(normalizedVideoId);
    const availableRelatedIds: string[] = [];

    for (const relatedVideo of relatedVideos) {
      const relatedAvailability = await checkEmbedPlayability(relatedVideo.id);
      await persistVideoAvailability(relatedVideo, relatedAvailability);
      if (relatedAvailability.status !== "available") {
        continue;
      }

      const admitted = await canAdmitVideoByStrictMetadata(relatedVideo.id);
      if (admitted) {
        availableRelatedIds.push(relatedVideo.id);
      } else {
        await pruneVideoAndAssociationsByVideoId(relatedVideo.id, "related-inline-strict-admission").catch(() => undefined);
      }
    }

    await persistRelatedVideoCache(normalizedVideoId, availableRelatedIds);
  }

  return video;
}

// ── Public ingestion exports ──────────────────────────────────────────────────

export async function getExternalVideoById(videoId: string) {
  return hydrateAndPersistVideo(videoId);
}

// ── Related discovery ─────────────────────────────────────────────────────────

export async function discoverRelatedVideosCascade(
  seedVideoId: string,
  options?: { maxDepth?: number; maxNewVideos?: number },
) {
  if (!ENABLE_YOUTUBE_RELATED_DISCOVERY || !hasDatabaseUrl()) {
    return { fetchedNodes: 0, discoveredNewVideos: 0 };
  }

  const maxDepth = Math.max(1, Math.min(4, Math.floor(options?.maxDepth ?? RELATED_DISCOVERY_MAX_DEPTH)));
  const maxNewVideos = Math.max(1, Math.min(800, Math.floor(options?.maxNewVideos ?? RELATED_DISCOVERY_MAX_NEW_VIDEOS)));
  const queue: Array<{ videoId: string; depth: number }> = [{ videoId: seedVideoId, depth: 0 }];
  const visited = new Set<string>([seedVideoId]);
  let fetchedNodes = 0;
  let discoveredNewVideos = 0;

  while (queue.length > 0 && discoveredNewVideos < maxNewVideos) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= maxDepth) continue;
    if (await hasStoredRelatedCache(current.videoId)) continue;

    const fanout = getRelatedFanoutForDepth(current.depth);
    const relatedVideos = (await fetchRelatedYouTubeVideos(current.videoId)).slice(0, fanout);
    fetchedNodes += 1;

    const uniqueCandidates: PersistableVideoRecord[] = [];
    for (const candidate of relatedVideos) {
      const normalizedCandidateId = normalizeYouTubeVideoId(candidate.id);
      if (!normalizedCandidateId || visited.has(normalizedCandidateId)) continue;
      visited.add(normalizedCandidateId);
      uniqueCandidates.push({ ...candidate, id: normalizedCandidateId });
    }

    await persistRelatedVideoCache(current.videoId, uniqueCandidates.map((c) => c.id));
    if (uniqueCandidates.length === 0) continue;

    const existingIds = await getExistingCatalogVideoIdSet(uniqueCandidates.map((c) => c.id));
    const newCandidates = uniqueCandidates.filter((c) => !existingIds.has(c.id));

    for (const candidate of newCandidates) {
      if (discoveredNewVideos >= maxNewVideos) break;

      const hydrated = await hydrateAndPersistVideo(candidate.id, candidate, {
        forceAvailabilityRefresh: true,
        skipRelatedDiscovery: true,
      });

      if (!hydrated) continue;

      if (!(await canAdmitVideoByStrictMetadata(candidate.id))) {
        await pruneVideoAndAssociationsByVideoId(candidate.id, "related-cascade-strict-admission").catch(() => undefined);
        continue;
      }

      discoveredNewVideos += 1;
      if (current.depth + 1 < maxDepth) {
        queue.push({ videoId: candidate.id, depth: current.depth + 1 });
      }
    }
  }

  debugCatalog("discoverRelatedVideosCascade:complete", { seedVideoId, maxDepth, maxNewVideos, fetchedNodes, discoveredNewVideos });
  return { fetchedNodes, discoveredNewVideos };
}

export async function runQuotaBackfill(budgetUnits: number): Promise<{
  seedsAttempted: number;
  fetchedNodes: number;
  discoveredNewVideos: number;
  unitsEstimated: number;
}> {
  const empty = { seedsAttempted: 0, fetchedNodes: 0, discoveredNewVideos: 0, unitsEstimated: 0 };

  if (!hasDatabaseUrl() || !ENABLE_YOUTUBE_RELATED_DISCOVERY) return empty;

  const maxSeeds = Math.max(0, Math.floor(budgetUnits / 100));
  if (maxSeeds === 0) return empty;

  const seeds = await prisma.$queryRaw<Array<{ videoId: string }>>`
    SELECT v.videoId FROM videos v
    WHERE NOT EXISTS (SELECT 1 FROM related r WHERE r.videoId = v.videoId)
    LIMIT ${maxSeeds}
  `;

  if (seeds.length === 0) return empty;

  let totalFetchedNodes = 0;
  let totalDiscoveredNewVideos = 0;

  for (let i = 0; i < seeds.length; i += BACKFILL_CONCURRENCY) {
    const chunk = seeds.slice(i, i + BACKFILL_CONCURRENCY);
    const results = await Promise.all(chunk.map(({ videoId }) => discoverRelatedVideosCascade(videoId, { maxDepth: 1 })));
    for (const result of results) {
      totalFetchedNodes += result.fetchedNodes;
      totalDiscoveredNewVideos += result.discoveredNewVideos;
    }
  }

  return {
    seedsAttempted: seeds.length,
    fetchedNodes: totalFetchedNodes,
    discoveredNewVideos: totalDiscoveredNewVideos,
    unitsEstimated: totalFetchedNodes * 100,
  };
}

export function maybeStartAutomaticRelatedBackfill(offset: number) {
  const now = Date.now();
  const shouldSchedule = shouldScheduleRelatedBackfill({
    enabled: ENABLE_AUTO_RELATED_BACKFILL && ENABLE_YOUTUBE_RELATED_DISCOVERY && hasDatabaseUrl(),
    offset,
    maxNewestOffset: AUTO_RELATED_BACKFILL_MAX_NEWEST_OFFSET,
    now,
    lastStartedAt: autoRelatedBackfillLastStartedAt,
    minIntervalMs: AUTO_RELATED_BACKFILL_MIN_INTERVAL_MS,
    hasInFlight: Boolean(autoRelatedBackfillInFlight),
    hasScheduled: Boolean(autoRelatedBackfillTimer),
  });

  if (!shouldSchedule) return;

  const startDelayMs = computeRelatedBackfillDelayMs(AUTO_RELATED_BACKFILL_DEFER_MS, AUTO_RELATED_BACKFILL_DEFER_JITTER_MS);
  autoRelatedBackfillScheduledFor = now + startDelayMs;

  autoRelatedBackfillTimer = setTimeout(() => {
    autoRelatedBackfillTimer = null;
    autoRelatedBackfillScheduledFor = 0;
    autoRelatedBackfillLastStartedAt = Date.now();

    autoRelatedBackfillInFlight = (async () => {
      try {
        const result = await runQuotaBackfill(AUTO_RELATED_BACKFILL_UNITS_PER_RUN);
        debugCatalog("auto-related-backfill:complete", {
          seedsAttempted: result.seedsAttempted,
          fetchedNodes: result.fetchedNodes,
          discoveredNewVideos: result.discoveredNewVideos,
          unitsEstimated: result.unitsEstimated,
          unitsPerRun: AUTO_RELATED_BACKFILL_UNITS_PER_RUN,
          delayMs: startDelayMs,
        });
      } catch (error) {
        debugCatalog("auto-related-backfill:error", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        autoRelatedBackfillInFlight = null;
      }
    })();
  }, startDelayMs);

  debugCatalog("auto-related-backfill:scheduled", {
    offset,
    delayMs: startDelayMs,
    scheduledFor: autoRelatedBackfillScheduledFor,
    unitsPerRun: AUTO_RELATED_BACKFILL_UNITS_PER_RUN,
    concurrency: BACKFILL_CONCURRENCY,
  });
}

// ── Admin imports / pruning ───────────────────────────────────────────────────

export async function importVideoFromDirectSource(source: string, options?: { discoverRelated?: boolean; forceApprove?: boolean }) {
  const normalizedVideoId = normalizeYouTubeVideoId(source);

  if (!normalizedVideoId) {
    return {
      videoId: null,
      decision: {
        allowed: false,
        reason: "invalid-video-id" as const,
        message: "Invalid YouTube URL or video id.",
      } satisfies PlaybackDecision,
    };
  }

  const existedBeforeImport = hasDatabaseUrl()
    ? Boolean(await getStoredVideoById(normalizedVideoId, { includeUnapproved: true }))
    : false;

  await hydrateAndPersistVideo(normalizedVideoId, undefined, {
    forceAvailabilityRefresh: true,
    skipRelatedDiscovery: true,
  });

  // Only auto-approve when the caller explicitly requests it (e.g. admin import).
  // User-submitted videos (suggest, playlist import) stay at approved=NULL so they
  // land in the admin pending queue before becoming visible to other users.
  if (hasDatabaseUrl() && options?.forceApprove) {
    await prisma.$executeRaw`
      UPDATE videos SET approved = 1, updated_at = ${new Date()} WHERE videoId = ${normalizedVideoId}
    `;
  }

  let decision = await getVideoPlaybackDecision(normalizedVideoId);

  if (hasDatabaseUrl()) {
    const fallbackRows = await prisma.$queryRaw<Array<{
      id: number;
      title: string;
      parsedArtist: string | null;
      channelTitle: string | null;
    }>>`
      SELECT id, title, parsedArtist, channelTitle FROM videos WHERE videoId = ${normalizedVideoId} LIMIT 1
    `;

    const fallbackRow = fallbackRows[0];
    const metadataAbsent = fallbackRow && !fallbackRow.parsedArtist?.trim();
    const decisionNeedsHelp =
      !decision.allowed &&
      (decision.reason === "missing-metadata" ||
        decision.reason === "unknown-video-type" ||
        decision.reason === "low-confidence");

    const fallbackMeta =
      fallbackRow && (metadataAbsent || decisionNeedsHelp)
        ? deriveAdminImportFallbackMetadata(fallbackRow.title, fallbackRow.channelTitle, PLAYBACK_MIN_CONFIDENCE)
        : null;

    if (fallbackRow && fallbackMeta) {
      const normalizedFallbackTitle =
        buildNormalizedVideoTitleFromMetadata(fallbackRow.title, fallbackMeta.artist, fallbackMeta.track) ??
        fallbackRow.title;

      await prisma.$executeRaw`
        UPDATE videos
        SET title = ${normalizedFallbackTitle},
            parsedArtist = ${fallbackMeta.artist},
            parsedTrack = ${fallbackMeta.track},
            parsedVideoType = ${fallbackMeta.videoType},
            parseMethod = ${"admin-direct-import-heuristic"},
            parseReason = ${fallbackMeta.reason},
            parseConfidence = ${fallbackMeta.confidence},
            parsedAt = ${new Date()}
        WHERE id = ${fallbackRow.id}
      `;

      scheduleArtistProjectionRefreshForName(fallbackMeta.artist);
      playbackDecisionCache.delete(normalizedVideoId);
      decision = await getVideoPlaybackDecision(normalizedVideoId);
    }
  }

  const shouldDiscoverRelated = (options?.discoverRelated ?? true) && !existedBeforeImport;
  if (shouldDiscoverRelated) {
    await discoverRelatedVideosCascade(normalizedVideoId);
  }

  return { videoId: normalizedVideoId, decision };
}

export async function pruneVideoAndAssociationsByVideoId(videoId: string, reason = "runtime-prune") {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return { pruned: false, deletedVideoRows: 0, reason: "invalid-or-no-db" };
  }

  const matchingRows = await prisma.video.findMany({
    where: { videoId: normalizedVideoId },
    select: { id: true, parsedArtist: true },
  });

  if (matchingRows.length === 0) {
    return { pruned: false, deletedVideoRows: 0, reason: "not-found" };
  }

  const ids = matchingRows.map((row) => row.id);
  const parsedArtistsToRefresh = Array.from(
    new Set(matchingRows.map((row) => row.parsedArtist?.trim()).filter((v): v is string => Boolean(v))),
  );

  const [siteVideoColumns, playlistColumns, favouriteColumns, artistVideoColumns, messageColumns, relatedColumns, videoFkRefs] =
    await Promise.all([
      loadTableColumns("site_videos"),
      loadTableColumns("playlistitems"),
      loadTableColumns("favourites"),
      loadTableColumns("videosbyartist"),
      loadTableColumns("messages"),
      loadTableColumns("related"),
      loadVideoForeignKeyRefs(),
    ]);

  const executeWithRetry = async (query: string, params: unknown[]) => {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await prisma.$executeRawUnsafe(query, ...params);
        return true;
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
        const message = error instanceof Error ? error.message : String(error ?? "");
        const lockError = code === "P2010" && (message.includes("1205") || message.includes("1213"));
        if (!lockError || attempt === maxAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
      }
    }
    return false;
  };

  try {
    const siteVideoRef = pickColumn(siteVideoColumns, ["video_id", "videoId"]);
    if (siteVideoRef) {
      await executeWithRetry(
        `DELETE FROM site_videos WHERE ${escapeSqlIdentifier(siteVideoRef.Field)} IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
    }

    const playlistRef = pickColumn(playlistColumns, ["video_id", "videoId"]);
    if (playlistRef) {
      if (/int|bigint|smallint|tinyint/i.test(playlistRef.Type)) {
        await executeWithRetry(
          `DELETE FROM playlistitems WHERE ${escapeSqlIdentifier(playlistRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } else {
        await executeWithRetry(`DELETE FROM playlistitems WHERE ${escapeSqlIdentifier(playlistRef.Field)} = ?`, [normalizedVideoId]);
      }
    }

    const favouriteRef = pickColumn(favouriteColumns, ["video_id", "videoId"]);
    if (favouriteRef) {
      if (/int|bigint|smallint|tinyint/i.test(favouriteRef.Type)) {
        await executeWithRetry(
          `DELETE FROM favourites WHERE ${escapeSqlIdentifier(favouriteRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } else {
        await executeWithRetry(`DELETE FROM favourites WHERE ${escapeSqlIdentifier(favouriteRef.Field)} = ?`, [normalizedVideoId]);
      }
    }

    const artistVideoRef = pickColumn(artistVideoColumns, ["video_id", "videoId", "id"]);
    if (artistVideoRef) {
      if (/int|bigint|smallint|tinyint/i.test(artistVideoRef.Type)) {
        await executeWithRetry(
          `DELETE FROM videosbyartist WHERE ${escapeSqlIdentifier(artistVideoRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } else {
        await executeWithRetry(`DELETE FROM videosbyartist WHERE ${escapeSqlIdentifier(artistVideoRef.Field)} = ?`, [normalizedVideoId]);
      }
    }

    const messageRef = pickColumn(messageColumns, ["video_id", "videoId"]);
    if (messageRef) {
      await executeWithRetry(`DELETE FROM messages WHERE ${escapeSqlIdentifier(messageRef.Field)} = ?`, [normalizedVideoId]);
    }

    const relatedVideoRef = pickColumn(relatedColumns, ["video_id", "videoId"]);
    const relatedRelatedRef = pickColumn(relatedColumns, ["related_video", "related"]);
    if (relatedVideoRef && relatedRelatedRef) {
      await executeWithRetry(
        `DELETE FROM related WHERE ${escapeSqlIdentifier(relatedVideoRef.Field)} = ? OR ${escapeSqlIdentifier(relatedRelatedRef.Field)} = ?`,
        [normalizedVideoId, normalizedVideoId],
      );
    } else if (relatedVideoRef) {
      await executeWithRetry(`DELETE FROM related WHERE ${escapeSqlIdentifier(relatedVideoRef.Field)} = ?`, [normalizedVideoId]);
    } else if (relatedRelatedRef) {
      await executeWithRetry(`DELETE FROM related WHERE ${escapeSqlIdentifier(relatedRelatedRef.Field)} = ?`, [normalizedVideoId]);
    }

    for (const fkRef of videoFkRefs) {
      if (!fkRef.tableName || fkRef.tableName === "videos" || !fkRef.columnName) continue;
      await executeWithRetry(
        `DELETE FROM ${escapeSqlIdentifier(fkRef.tableName)} WHERE ${escapeSqlIdentifier(fkRef.columnName)} IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
    }

    await executeWithRetry(`DELETE FROM videos WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    const message = error instanceof Error ? error.message : String(error ?? "");
    const lockError = code === "P2010" && (message.includes("1205") || message.includes("1213"));
    const fkError = code === "P2010" && message.includes("1451");

    const siteVideoRef = pickColumn(siteVideoColumns, ["video_id", "videoId"]);
    if (siteVideoRef) {
      try {
        await executeWithRetry(
          `UPDATE site_videos SET status = 'unavailable' WHERE ${escapeSqlIdentifier(siteVideoRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } catch {
        // best-effort fallback
      }
    }

    return {
      pruned: false,
      deletedVideoRows: 0,
      reason: lockError ? "lock-timeout-marked-unavailable" : fkError ? "fk-constraint-delete-failed" : "delete-failed",
    };
  }

  await clearGenreCardThumbnailForVideo(normalizedVideoId);
  void markAvailableVideoMaxIdDirty().catch(() => undefined);

  if (reason === "admin-hard-delete") {
    try {
      await prisma.$executeRaw`
        INSERT INTO rejected_videos (video_id, reason, rejected_at)
        VALUES (${normalizedVideoId}, ${"admin-deleted"}, ${new Date()})
        ON DUPLICATE KEY UPDATE reason = VALUES(reason), rejected_at = VALUES(rejected_at)
      `;
      rejectedVideoCache.set(normalizedVideoId, { expiresAt: Date.now() + REJECTED_VIDEO_CACHE_TTL_MS, rejected: true });
    } catch {
      // best-effort only
    }
  }

  // Trigger full cross-module cache invalidation if a callback has been registered.
  _fullCacheInvalidator?.();

  debugCatalog("pruneVideoAndAssociationsByVideoId:done", {
    videoId: normalizedVideoId,
    deletedVideoRows: ids.length,
    reason,
  });

  for (const artistName of parsedArtistsToRefresh) {
    scheduleArtistProjectionRefreshForName(artistName);
  }

  return { pruned: true, deletedVideoRows: ids.length, reason };
}

// ── Playback decision ─────────────────────────────────────────────────────────

export async function getVideoPlaybackDecision(videoId?: string): Promise<PlaybackDecision> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return { allowed: false, reason: "invalid-video-id", message: "Sorry, that video cannot be played on YehThatRocks." };
  }

  if (!hasDatabaseUrl()) return { allowed: true, reason: "ok" };

  const cachedDecision = playbackDecisionCache.get(normalizedVideoId);
  const now = Date.now();
  if (cachedDecision && cachedDecision.expiresAt > now) return cachedDecision.decision;

  const fetchDecisionRows = async () =>
    prisma.$queryRaw<Array<PlaybackDecisionRow>>`
      SELECT
        v.id, v.title, v.description, v.parsedArtist, v.parsedTrack, v.parsedVideoType, v.parseConfidence,
        EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available') AS hasAvailable,
        EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status = 'unavailable')) AS hasBlocked,
        EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'check-failed') AS hasCheckFailed
      FROM videos v
      WHERE v.videoId = ${normalizedVideoId} AND COALESCE(v.approved, 0) = 1
      ORDER BY hasAvailable DESC, hasBlocked ASC, hasCheckFailed ASC, v.updated_at DESC, v.id DESC
      LIMIT 1
    `;

  let row = (await fetchDecisionRows())[0];
  let hydratedFromDirectRequest = false;

  if (!row) {
    const hydrated = await hydrateAndPersistVideo(normalizedVideoId);

    if (!hydrated) {
      const decision: PlaybackDecision = { allowed: false, reason: "not-found", message: "Sorry, that video cannot be played on YehThatRocks." };
      playbackDecisionCache.set(normalizedVideoId, { expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS, decision });
      return decision;
    }

    // The video was just ingested and lands with approved=NULL (pending admin review).
    // The approved=1 filter won't find it, so query without that restriction to allow
    // the requesting user to play it immediately while it stays unapproved for others.
    const unapprovedRows = await prisma.$queryRaw<Array<PlaybackDecisionRow>>`
      SELECT
        v.id, v.title, v.description, v.parsedArtist, v.parsedTrack, v.parsedVideoType, v.parseConfidence,
        EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'available') AS hasAvailable,
        EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND (sv.status IS NULL OR sv.status = 'unavailable')) AS hasBlocked,
        EXISTS (SELECT 1 FROM site_videos sv WHERE sv.video_id = v.id AND sv.status = 'check-failed') AS hasCheckFailed
      FROM videos v
      WHERE v.videoId = ${normalizedVideoId}
      ORDER BY hasAvailable DESC, hasBlocked ASC, hasCheckFailed ASC, v.updated_at DESC, v.id DESC
      LIMIT 1
    `;
    const unapprovedRow = unapprovedRows[0];
    if (unapprovedRow && (Boolean(unapprovedRow.hasAvailable) || Boolean(unapprovedRow.hasCheckFailed))) {
      const passthroughDecision: PlaybackDecision = { allowed: true, reason: "ok" };
      playbackDecisionCache.set(normalizedVideoId, { expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS, decision: passthroughDecision });
      return passthroughDecision;
    }

    const decision: PlaybackDecision = { allowed: false, reason: "not-found", message: "Sorry, that video cannot be played on YehThatRocks." };
    playbackDecisionCache.set(normalizedVideoId, { expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS, decision });
    return decision;
  }

  if (!Boolean(row.hasAvailable)) {
    if (!hydratedFromDirectRequest) {
      await hydrateAndPersistVideo(normalizedVideoId, undefined, { forceAvailabilityRefresh: true });
      row = (await fetchDecisionRows())[0] ?? row;
    }

    if (!Boolean(row.hasAvailable)) {
      if (Boolean(row.hasCheckFailed) && !Boolean(row.hasBlocked)) {
        const passthroughDecision: PlaybackDecision = { allowed: true, reason: "ok" };
        playbackDecisionCache.set(normalizedVideoId, { expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS, decision: passthroughDecision });
        return passthroughDecision;
      }

      const decision: PlaybackDecision = { allowed: false, reason: "unavailable", message: "Sorry, that video cannot be played on YehThatRocks." };
      playbackDecisionCache.set(normalizedVideoId, { expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS, decision });
      return decision;
    }
  }

  const needsMetadataBackfill =
    !row.parsedArtist?.trim() ||
    !row.parsedTrack?.trim() ||
    row.parsedVideoType === "unknown" ||
    !Number.isFinite(Number(row.parseConfidence ?? NaN)) ||
    Number(row.parseConfidence ?? NaN) < PLAYBACK_MIN_CONFIDENCE;

  if (needsMetadataBackfill) {
    triggerRuntimeMetadataBackfill(row.id, {
      id: normalizedVideoId,
      title: row.title,
      channelTitle: "YouTube",
      genre: "Rock / Metal",
      favourited: 0,
      description: row.description ?? "Catalog video pending metadata classification.",
      thumbnail: getYouTubeThumbnailUrl(normalizedVideoId),
    });
  }

  const decision = evaluatePlaybackMetadataEligibility(row);

  if (
    !decision.allowed &&
    Boolean(row.hasAvailable) &&
    !Boolean(row.hasBlocked) &&
    (decision.reason === "missing-metadata" || decision.reason === "unknown-video-type" || decision.reason === "low-confidence")
  ) {
    await prisma.siteVideo.updateMany({
      where: { videoId: row.id },
      data: {
        status: "check-failed",
        title: truncate(`${row.title} [metadata-gate:${decision.reason}]`, 255),
      },
    });

    const passthroughDecision: PlaybackDecision = { allowed: true, reason: "ok" };
    playbackDecisionCache.set(normalizedVideoId, { expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS, decision: passthroughDecision });
    return passthroughDecision;
  }

  playbackDecisionCache.set(normalizedVideoId, { expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS, decision });
  return decision;
}
