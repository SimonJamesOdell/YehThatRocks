import { prisma } from "@/lib/db";
import { getSearchRankingSignals } from "@/lib/search-flag-data";
import {
  artists as seedArtists,
  genres as seedGenres,
  getArtistBySlug as getSeedArtistBySlug,
  getRelatedVideos as getSeedRelatedVideos,
  getVideoById as getSeedVideoById,
  searchCatalog as searchSeedCatalog,
  videos as seedVideos,
  type ArtistRecord,
  type VideoRecord,
} from "@/lib/catalog";

export type DataSourceStatus = {
  mode: "seed" | "database" | "database-error";
  envConfigured: boolean;
  videoCount: number;
  artistCount: number;
  genreCount: number;
  detail: string;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  itemCount: number;
  leadVideoId: string;
};

export type PlaylistVideoRecord = VideoRecord & {
  playlistItemId?: string;
};

export type PlaylistDetail = {
  id: string;
  name: string;
  videos: PlaylistVideoRecord[];
};

export type WatchHistoryEntry = {
  video: VideoRecord;
  lastWatchedAt: string;
  watchCount: number;
  maxProgressPercent: number;
};

export type HiddenVideoEntry = {
  video: VideoRecord;
  hiddenAt: string;
};

export type GenreCard = {
  genre: string;
  previewVideoId: string | null;
};

type PreviewStore = {
  favouriteIdsByUser: Map<number, Set<string>>;
  playlistsByUser: Map<number, PlaylistDetail[]>;
};

type RankedVideoRow = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  parsedArtist?: string | null;
  favourited: number;
  description: string | null;
};

type StoredVideoRow = RankedVideoRow & {
  id: number;
};

type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

type VideoAvailabilityStatus = "available" | "unavailable" | "check-failed";

type VideoAvailability = {
  status: VideoAvailabilityStatus;
  reason: string;
};

type PersistableVideoRecord = VideoRecord & {
  thumbnail?: string;
};

type YouTubeRelatedSearchResponse = {
  items?: Array<{
    id?: {
      videoId?: string;
    };
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

type ParsedVideoMetadata = {
  artist: string | null;
  track: string | null;
  videoType: string | null;
  confidence: number | null;
  reason: string | null;
};

type PlaybackDecisionRow = {
  id: number;
  title: string;
  description: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  hasAvailable: number;
  hasBlocked: number;
};

export type PlaybackDecision = {
  allowed: boolean;
  reason:
    | "ok"
    | "invalid-video-id"
    | "not-found"
    | "missing-metadata"
    | "low-confidence"
    | "unknown-video-type"
    | "unavailable";
  message?: string;
};

type CachedPlaybackDecision = {
  expiresAt: number;
  decision: PlaybackDecision;
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const AGE_RESTRICTED_PATTERNS = [
  /Sign in to confirm your age/i,
  /age[-\s]?restricted/i,
  /playerAgeGateRenderer/i,
  /desktopLegacyAgeGateReason/i,
  /"isFamilySafe"\s*:\s*false/i,
  /"status"\s*:\s*"AGE_CHECK_REQUIRED"/i,
  /"status"\s*:\s*"LOGIN_REQUIRED"[\s\S]{0,240}"reason"\s*:\s*"[^"]*age/i,
];
const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || undefined;
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || undefined;
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
const GROQ_RETRY_COOLDOWN_MS = Math.max(
  300_000,
  Number(process.env.GROQ_RETRY_COOLDOWN_MS || String(6 * 60 * 60 * 1000)),
);
const PLAYBACK_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.PLAYBACK_MIN_CONFIDENCE || "0.8")));
const CATALOG_DEBUG_ENABLED = process.env.NODE_ENV === "development" && process.env.DEBUG_CATALOG === "1";
const PLAYBACK_DECISION_CACHE_TTL_MS = 15_000;
const playbackDecisionCache = new Map<string, CachedPlaybackDecision>();
const ALLOWED_VIDEO_TYPES = new Set(["official", "lyric", "live", "cover", "remix", "fan"]);
const NON_MUSIC_SIGNAL_PATTERN = /\b(instagram|tiktok|facebook|whatsapp|snapchat|podcast|interview|prank|challenge|reaction|vlog|tutorial|gameplay|livestream|stream highlights?|shorts?)\b/i;

let hasCheckedVideoMetadataColumns = false;
let videoMetadataColumnsAvailable = false;
let hasCheckedVideoChannelTitleColumn = false;
let videoChannelTitleColumnAvailable = false;

function debugCatalog(event: string, detail?: Record<string, unknown>) {
  if (!CATALOG_DEBUG_ENABLED) {
    return;
  }

  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[catalog-data] ${event}${payload}`);
}

function containsAgeRestrictionMarker(html: string) {
  return AGE_RESTRICTED_PATTERNS.some((pattern) => pattern.test(html));
}

function isLikelyNonMusicSignal(row: PlaybackDecisionRow) {
  const haystack = `${row.title}\n${row.description ?? ""}`;
  return NON_MUSIC_SIGNAL_PATTERN.test(haystack);
}

function evaluatePlaybackMetadataEligibility(row: PlaybackDecisionRow): PlaybackDecision {
  const artist = row.parsedArtist?.trim() ?? "";
  const track = row.parsedTrack?.trim() ?? "";
  const videoType = (row.parsedVideoType ?? "").trim().toLowerCase();
  const confidence = Number(row.parseConfidence ?? NaN);

  if (!artist || !track) {
    return {
      allowed: false,
      reason: "missing-metadata",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (!ALLOWED_VIDEO_TYPES.has(videoType)) {
    return {
      allowed: false,
      reason: "unknown-video-type",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (!Number.isFinite(confidence) || confidence < PLAYBACK_MIN_CONFIDENCE) {
    return {
      allowed: false,
      reason: "low-confidence",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (isLikelyNonMusicSignal(row) && confidence < 0.9) {
    return {
      allowed: false,
      reason: "low-confidence",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  return { allowed: true, reason: "ok" };
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function scoreLikelyMojibake(value: string) {
  const markerCount = (value.match(/(?:Ã.|Â.|â.|Ð.|Ñ.|┬.|�)/g) ?? []).length;
  const replacementCount = (value.match(/�/g) ?? []).length;
  const boxDrawingCount = (value.match(/[┬▒░]/g) ?? []).length;
  return markerCount * 3 + replacementCount * 4 + boxDrawingCount * 2;
}

function normalizePossiblyMojibakeText(value: string) {
  const input = value.trim();
  if (!input) {
    return input;
  }

  const originalScore = scoreLikelyMojibake(input);
  if (originalScore === 0) {
    return input;
  }

  const candidates = new Set<string>();
  const repairedOnce = Buffer.from(input, "latin1").toString("utf8").trim();
  if (repairedOnce && repairedOnce !== input) {
    candidates.add(repairedOnce);
  }

  const repairedTwice = Buffer.from(repairedOnce, "latin1").toString("utf8").trim();
  if (repairedTwice && repairedTwice !== input) {
    candidates.add(repairedTwice);
  }

  let best = input;
  let bestScore = originalScore;

  for (const candidate of candidates) {
    const candidateScore = scoreLikelyMojibake(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  // Require a meaningful reduction so artistic punctuation/symbol choices are preserved.
  return bestScore <= originalScore - 2 ? best : input;
}

async function withSoftTimeout<T>(label: string, timeoutMs: number, operation: () => Promise<T>) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function normalizeParsedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "null") {
    return null;
  }

  return truncate(trimmed, maxLength);
}

function normalizeParsedConfidence(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeLooseToken(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSimpleTitleSides(title: string) {
  const withDash = title.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (withDash.length >= 2) {
    return { left: withDash[0], right: withDash[1] };
  }

  const withPipe = title.split("|").map((part) => part.trim()).filter(Boolean);
  if (withPipe.length >= 2) {
    return { left: withPipe[0], right: withPipe[1] };
  }

  return null;
}

function inferArtistFromTitle(title: string) {
  const sides = parseSimpleTitleSides(title);
  if (!sides) {
    return null;
  }

  const markerPattern = /\b(official|video|lyrics?|lyric|remaster(?:ed)?|live|hd|4k|audio|visualizer|feat\.?|ft\.?)\b|[\[(]/i;
  const leftHasMarkers = markerPattern.test(sides.left);
  const rightHasMarkers = markerPattern.test(sides.right);

  if (leftHasMarkers && !rightHasMarkers) {
    return sides.right;
  }

  if (rightHasMarkers && !leftHasMarkers) {
    return sides.left;
  }

  if (leftHasMarkers && rightHasMarkers) {
    return null;
  }

  const leftWords = sides.left.trim().split(/\s+/).filter(Boolean).length;
  const rightWords = sides.right.trim().split(/\s+/).filter(Boolean).length;

  if (leftWords >= 1 && leftWords <= 4 && rightWords >= 1 && rightWords <= 12) {
    return sides.left;
  }

  if (rightWords >= 1 && rightWords <= 4 && leftWords > 4) {
    return sides.right;
  }

  return null;
}

function sanitizeFallbackMetadataToken(value: string | null | undefined, maxLength: number) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(official\s+video|official|lyrics?|lyric\s+video|audio|visualizer|hd|4k|remaster(?:ed)?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeParsedString(cleaned, maxLength);
}

function deriveArtistFromChannelTitle(channelTitle: string | null | undefined, title?: string | null) {
  if (!channelTitle) {
    return null;
  }

  const cleaned = channelTitle
    .replace(/\s*-\s*topic\s*$/i, "")
    .replace(/\b(official|vevo|records|music channel)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidate = sanitizeFallbackMetadataToken(cleaned, 255);
  if (!candidate) {
    return null;
  }

  const normalizedCandidate = candidate.toLowerCase();
  if (normalizedCandidate === "youtube" || normalizedCandidate === "unknown artist") {
    return null;
  }

  if (title && normalizedCandidate === title.trim().toLowerCase()) {
    return null;
  }

  return candidate;
}

function deriveAdminImportFallbackMetadata(title: string, channelTitle?: string | null) {
  const sides = parseSimpleTitleSides(title);

  const inferredArtist = inferArtistFromTitle(title);
  const channelArtist = deriveArtistFromChannelTitle(channelTitle, title);
  const selectedArtist = inferredArtist ?? channelArtist;
  if (!selectedArtist) {
    return null;
  }

  const fallbackSourceTrack = sides
    ? (() => {
        const inferredArtistToken = normalizeLooseToken(selectedArtist);
        const leftToken = normalizeLooseToken(sides.left);
        return inferredArtistToken === leftToken ? sides.right : sides.left;
      })()
    : title;

  const fallbackArtist = sanitizeFallbackMetadataToken(selectedArtist, 255);
  const fallbackTrack = sanitizeFallbackMetadataToken(
    fallbackSourceTrack,
    255,
  );

  if (!fallbackArtist || !fallbackTrack) {
    return null;
  }

  return {
    artist: fallbackArtist,
    track: fallbackTrack,
    videoType: "official",
    confidence: Math.max(PLAYBACK_MIN_CONFIDENCE, 0.82),
    reason: inferredArtist
      ? "Admin direct import heuristic fallback from title parsing."
      : "Admin direct import fallback from channel title.",
  } as const;
}

function extractJsonObject(content: unknown) {
  if (typeof content !== "string") {
    throw new Error("Groq returned non-string message content");
  }

  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }

    throw new Error(`Unable to parse Groq JSON payload: ${trimmed.slice(0, 220)}`);
  }
}

async function ensureVideoMetadataColumnsAvailable() {
  if (hasCheckedVideoMetadataColumns || !hasDatabaseUrl()) {
    return videoMetadataColumnsAvailable;
  }

  hasCheckedVideoMetadataColumns = true;

  try {
    const columns = await prisma.$queryRaw<Array<{ Field: string }>>`SHOW COLUMNS FROM videos`;
    const names = new Set(columns.map((column) => column.Field));
    videoMetadataColumnsAvailable = names.has("parsedArtist") && names.has("parsedTrack");
  } catch {
    videoMetadataColumnsAvailable = false;
  }

  return videoMetadataColumnsAvailable;
}

async function ensureVideoChannelTitleColumnAvailable() {
  if (hasCheckedVideoChannelTitleColumn || !hasDatabaseUrl()) {
    return videoChannelTitleColumnAvailable;
  }

  hasCheckedVideoChannelTitleColumn = true;

  try {
    const columns = await prisma.$queryRaw<Array<{ Field: string }>>`SHOW COLUMNS FROM videos LIKE 'channelTitle'`;
    videoChannelTitleColumnAvailable = columns.length > 0;
  } catch {
    videoChannelTitleColumnAvailable = false;
  }

  return videoChannelTitleColumnAvailable;
}

function buildGroqMetadataPrompt(video: PersistableVideoRecord) {
  const descriptionSnippet = truncate(video.description ?? "", 700);

  return [
    "Extract music metadata from this YouTube video record.",
    "Return JSON only with keys:",
    '{"artist":string|null,"track":string|null,"videoType":"official"|"lyric"|"live"|"cover"|"remix"|"fan"|"unknown","confidence":number,"reason":string}',
    "Rules:",
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
  if (!GROQ_API_KEY) {
    return null;
  }

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
            content:
              "You are a strict music metadata extraction service. Output valid JSON only, with no markdown fences.",
          },
          {
            role: "user",
            content: buildGroqMetadataPrompt(video),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Groq API error ${response.status}: ${body.slice(0, 260)}`);
    }

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
    debugCatalog("classifyVideoMetadataWithGroq:error", {
      videoId: video.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function maybePersistRuntimeMetadata(videoRowId: number, video: PersistableVideoRecord) {
  if (!GROQ_API_KEY) {
    return;
  }

  const hasColumns = await ensureVideoMetadataColumnsAvailable();
  if (!hasColumns) {
    return;
  }

  try {
    const existing = await prisma.$queryRaw<
      Array<{
        parsedArtist: string | null;
        parsedTrack: string | null;
        parsedVideoType: string | null;
        parseConfidence: number | null;
        parseMethod: string | null;
        parsedAt: Date | null;
      }>
    >`
      SELECT parsedArtist, parsedTrack, parsedVideoType, parseConfidence, parseMethod, parsedAt
      FROM videos
      WHERE id = ${videoRowId}
      LIMIT 1
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
      ? (parsedAtRaw instanceof Date ? parsedAtRaw.getTime() : new Date(parsedAtRaw).getTime())
      : NaN;
    const hasRecentGroqAttempt =
      Number.isFinite(parsedAtMs) &&
      Date.now() - parsedAtMs < GROQ_RETRY_COOLDOWN_MS &&
      (existingMeta?.parseMethod === "groq-error" || (existingMeta?.parseMethod ?? "").startsWith("groq-llm"));

    if (hasRecentGroqAttempt) {
      return;
    }

    const parsed = await classifyVideoMetadataWithGroq(video);
    if (!parsed) {
      await prisma.$executeRaw`
        UPDATE videos
        SET
          parseMethod = ${"groq-error"},
          parseReason = ${"Groq metadata classification failed. Retry deferred by cooldown."},
          parsedAt = ${new Date()}
        WHERE id = ${videoRowId}
      `;
      return;
    }

    const correctedArtist = parsed.artist;
    const correctedTrack = parsed.track;
    const artistKnown = correctedArtist ? await isKnownArtistName(correctedArtist) : false;
    const adjustedConfidence = artistKnown
      ? Math.max(parsed.confidence ?? 0, 0.9)
      : parsed.confidence;
    const correctedReasonBase = parsed.reason;
    const correctedReason = artistKnown
      ? `${correctedReasonBase ?? ""}${correctedReasonBase ? " | " : ""}Artist matched known artists catalog.`
      : correctedReasonBase;

    await prisma.$executeRaw`
      UPDATE videos
      SET
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
      artist: correctedArtist,
      track: correctedTrack,
      confidence: adjustedConfidence,
      artistKnown,
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

const runtimeMetadataBackfillInFlight = new Set<number>();

function triggerRuntimeMetadataBackfill(videoRowId: number, video: PersistableVideoRecord) {
  if (runtimeMetadataBackfillInFlight.has(videoRowId)) {
    return;
  }

  runtimeMetadataBackfillInFlight.add(videoRowId);
  void maybePersistRuntimeMetadata(videoRowId, video)
    .catch(() => undefined)
    .finally(() => {
      runtimeMetadataBackfillInFlight.delete(videoRowId);
    });
}

function getYouTubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function dedupeRankedRows(rows: RankedVideoRow[]) {
  const byId = new Map<string, RankedVideoRow>();

  for (const row of rows) {
    if (!byId.has(row.videoId)) {
      byId.set(row.videoId, row);
    }
  }

  return [...byId.values()];
}

function selectUniqueVideoRows(rows: RankedVideoRow[], blockedIds: Set<string>, limit: number) {
  const selected: RankedVideoRow[] = [];

  for (const row of rows) {
    if (blockedIds.has(row.videoId)) {
      continue;
    }

    blockedIds.add(row.videoId);
    selected.push(row);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function rotateRowsBySeed(rows: RankedVideoRow[], seedInput: string) {
  if (rows.length <= 1) {
    return rows;
  }

  let hash = 0;
  for (let index = 0; index < seedInput.length; index += 1) {
    hash = (hash * 31 + seedInput.charCodeAt(index)) >>> 0;
  }

  const offset = hash % rows.length;
  return [...rows.slice(offset), ...rows.slice(0, offset)];
}

export function normalizeYouTubeVideoId(value?: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const candidates: string[] = [];

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const shortId = parsed.pathname.split("/").filter(Boolean)[0];
      if (shortId) {
        candidates.push(shortId);
      }
    }

    const searchId = parsed.searchParams.get("v");
    if (searchId) {
      candidates.push(searchId);
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const embedLikeIndex = segments.findIndex((segment) => ["embed", "shorts", "live", "v"].includes(segment));
    if (embedLikeIndex >= 0 && segments[embedLikeIndex + 1]) {
      candidates.push(segments[embedLikeIndex + 1]);
    }
  } catch {
    const watchMatch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (watchMatch?.[1]) {
      candidates.push(watchMatch[1]);
    }

    const shortMatch = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i);
    if (shortMatch?.[1]) {
      candidates.push(shortMatch[1]);
    }
  }

  return candidates.find((candidate) => YOUTUBE_VIDEO_ID_PATTERN.test(candidate));
}

export function resolveSelectedVideoId(
  searchParams?: Record<string, string | string[] | undefined>,
  fallbackVideoId?: string,
) {
  const rawSelectedVideo = typeof searchParams?.v === "string"
    ? searchParams.v
    : Array.isArray(searchParams?.v)
      ? searchParams.v[0]
      : undefined;
  const selectedVideoId = normalizeYouTubeVideoId(rawSelectedVideo) ?? rawSelectedVideo;

  return selectedVideoId ?? fallbackVideoId;
}

const TOP_POOL_CACHE_TTL_MS = 60_000;
let topPoolCache:
  | {
      expiresAt: number;
      rows: RankedVideoRow[];
    }
  | undefined;
let topPoolInFlight:
  | {
      limit: number;
      promise: Promise<RankedVideoRow[]>;
    }
  | undefined;
const NEWEST_CACHE_TTL_MS = 15_000;
let newestVideosCache:
  | {
      expiresAt: number;
      count: number;
      rows: RankedVideoRow[];
    }
  | undefined;
const newestVideosInFlight = new Map<string, Promise<VideoRecord[]>>();

const GENRE_RESULTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const GENRE_CARDS_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const CATEGORY_QUERY_TIMEOUT_MS = 2_500;
const genreArtistsCache = new Map<string, { expiresAt: number; artists: ArtistRecord[] }>();
const genreVideosCache = new Map<string, { expiresAt: number; videos: VideoRecord[] }>();
const genreVideosInFlight = new Map<string, Promise<VideoRecord[]>>();
let genreCardsCache: { expiresAt: number; cards: GenreCard[] } | undefined;
let genreCardsInFlight: Promise<GenreCard[]> | undefined;
const ARTIST_VIDEOS_CACHE_TTL_MS = 60_000;
const artistVideosCache = new Map<string, { expiresAt: number; videos: VideoRecord[] }>();
const RELATED_VIDEOS_CACHE_TTL_MS = 20_000;
const relatedVideosCache = new Map<string, { expiresAt: number; videos: VideoRecord[] }>();
const relatedVideosInFlight = new Map<string, Promise<VideoRecord[]>>();
const HIDDEN_VIDEO_IDS_CACHE_TTL_MS = 20_000;
const hiddenVideoIdsCache = new Map<number, { expiresAt: number; ids: Set<string> }>();
const hiddenVideoIdsInFlight = new Map<number, Promise<Set<string>>>();
const ENABLE_SAME_GENRE_RELATED = process.env.RELATED_ENABLE_SAME_GENRE === "1";
const ARTIST_LETTER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const artistLetterCache = new Map<string, { expiresAt: number; rows: Array<ArtistRecord & { videoCount: number }> }>();
const artistLetterInFlight = new Map<string, Promise<Array<ArtistRecord & { videoCount: number }>>>();
const ARTIST_LETTER_PAGE_CACHE_TTL_MS = 60_000; // 1 minute
const artistLetterPageCache = new Map<string, { expiresAt: number; rows: Array<ArtistRecord & { videoCount: number }> }>();
const artistLetterPageInFlight = new Map<string, Promise<Array<ArtistRecord & { videoCount: number }>>>();
const ARTIST_SEARCH_CACHE_TTL_MS = 10_000;
const artistSearchCache = new Map<string, {
  expiresAt: number;
  rows: Array<{ name: string; country: string | null; genre1: string | null }>;
}>();
const artistSearchInFlight = new Map<string, Promise<Array<{ name: string; country: string | null; genre1: string | null }>>>();
const ARTIST_STATS_TABLE_CACHE_TTL_MS = 60_000;
const ARTIST_PROJECTION_REFRESH_TTL_MS = 30_000;
const artistProjectionRefreshCache = new Map<string, { expiresAt: number }>();
const artistProjectionRefreshInFlight = new Map<string, Promise<void>>();
const ARTISTS_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
let artistsListCache:
  | {
      expiresAt: number;
      rows: ArtistRecord[];
    }
  | undefined;
let artistsListInFlight: Promise<ArtistRecord[]> | undefined;
const ARTIST_SLUG_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
let artistSlugLookupCache:
  | {
      expiresAt: number;
      rowsBySlug: Map<string, ArtistRecord>;
    }
  | undefined;
let artistSlugLookupInFlight: Promise<Map<string, ArtistRecord>> | undefined;
const ARTIST_SINGLE_SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
const artistSingleSlugCache = new Map<string, { expiresAt: number; artist: ArtistRecord }>();
const ARTIST_STATS_LETTER_BACKFILL_TTL_MS = 10 * 60 * 1000;
const artistStatsLetterBackfillCache = new Map<string, { expiresAt: number }>();
const artistStatsLetterBackfillInFlight = new Map<string, Promise<void>>();
let artistColumnMapCache:
  | {
      name: string;
      normalizedName: string | null;
      country: string | null;
      genreColumns: string[];
    }
  | undefined;
let artistVideoColumnMapCache:
  | {
      artistName: string;
      normalizedArtistName: string | null;
      videoRef: string;
      joinsOnVideoPrimaryId: boolean;
    }
  | undefined;
let videoArtistNormalizationColumnCache: string | null | undefined;
let artistVideoStatsSourceCache: "videosbyartist" | "parsedArtist" | undefined;
const KNOWN_ARTIST_MATCH_CACHE_TTL_MS = 10 * 60 * 1000;
const knownArtistMatchCache = new Map<string, { expiresAt: number; known: boolean }>();
let artistStatsProjectionAvailabilityCache:
  | {
      checkedAt: number;
      available: boolean;
    }
  | undefined;
let artistStatsThumbnailColumnAvailabilityCache:
  | {
      checkedAt: number;
      available: boolean;
    }
  | undefined;

let genreListCache: { expiresAt: number; genres: string[] } | undefined;

const PREVIEW_DEFAULT_USER_ID = 1;

const seedPlaylists: PlaylistDetail[] = [
  {
    id: "1",
    name: "Late Night Riffs",
    videos: [seedVideos[0], seedVideos[2], seedVideos[4]],
  },
  {
    id: "2",
    name: "Cathedral Echoes",
    videos: [seedVideos[3], seedVideos[0], seedVideos[1]],
  },
  {
    id: "3",
    name: "Gym Violence",
    videos: [seedVideos[4], seedVideos[2], seedVideos[1]],
  },
];

declare global {
  var __yehPreviewStore: PreviewStore | undefined;
}

function createPreviewStore(): PreviewStore {
  return {
    favouriteIdsByUser: new Map([
      [PREVIEW_DEFAULT_USER_ID, new Set(seedVideos.slice(0, 3).map((video) => video.id))],
    ]),
    playlistsByUser: new Map([
      [
        PREVIEW_DEFAULT_USER_ID,
        seedPlaylists.map((playlist) => ({
          ...playlist,
          videos: [...playlist.videos],
        })),
      ],
    ]),
  };
}

function getPreviewStore(): PreviewStore {
  if (!globalThis.__yehPreviewStore) {
    globalThis.__yehPreviewStore = createPreviewStore();
  }

  return globalThis.__yehPreviewStore;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeArtistKey(value: string) {
  return value.trim().toLowerCase();
}

export function getGenreSlug(value: string) {
  return slugify(value);
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

function resetGenreCardCaches() {
  genreCardsCache = undefined;
  genreListCache = undefined;
}

async function clearGenreCardThumbnailForVideo(videoId: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return;
  }

  try {
    const cleared = await prisma.$executeRaw`
      UPDATE genre_cards
      SET thumbnail_video_id = NULL
      WHERE CONVERT(thumbnail_video_id USING utf8mb4) = CONVERT(${normalizedVideoId} USING utf8mb4)
    `;

    if (Number(cleared) > 0) {
      resetGenreCardCaches();
      debugCatalog("clearGenreCardThumbnailForVideo:cleared", {
        videoId: normalizedVideoId,
        cleared,
      });
    }
  } catch {
    // best effort only: category cards are periodically rebuilt by maintenance scripts
  }
}

async function getRankedTopPool(limit = 129): Promise<RankedVideoRow[]> {
  const now = Date.now();

  if (topPoolCache && topPoolCache.expiresAt > now && topPoolCache.rows.length >= limit) {
    return topPoolCache.rows.slice(0, limit);
  }

  if (topPoolInFlight && topPoolInFlight.limit >= limit) {
    const rows = await topPoolInFlight.promise;
    return rows.slice(0, limit);
  }

  const fetchPromise = (async () => {
    let rows: RankedVideoRow[] = [];

    try {
      rows = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT
          v.videoId,
          v.title,
          NULL AS channelTitle,
          COALESCE(v.favourited, 0) AS favourited,
          v.description
        FROM videos v
        WHERE v.videoId IS NOT NULL
          AND CHAR_LENGTH(v.videoId) = 11
          AND EXISTS (
            SELECT 1
            FROM site_videos sv
            WHERE sv.video_id = v.id
              AND sv.status = 'available'
          )
        ORDER BY COALESCE(v.favourited, 0) DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
        LIMIT ${limit}
      `;
    } catch {
      rows = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT
          v.videoId,
          v.title,
          NULL AS channelTitle,
          COALESCE(fv.favouriteCount, 0) AS favourited,
          v.description
        FROM videos v
        LEFT JOIN (
          SELECT
            f.videoId,
            COUNT(DISTINCT f.userid) AS favouriteCount
          FROM favourites f
          WHERE f.videoId IS NOT NULL
          GROUP BY f.videoId
        ) fv ON fv.videoId = v.videoId
        WHERE v.videoId IS NOT NULL
          AND CHAR_LENGTH(v.videoId) = 11
          AND EXISTS (
            SELECT 1
            FROM site_videos sv
            WHERE sv.video_id = v.id
              AND sv.status = 'available'
          )
        ORDER BY COALESCE(fv.favouriteCount, 0) DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
        LIMIT ${limit}
      `;
    }

    const dedupedRows = dedupeRankedRows(rows);

    topPoolCache = {
      expiresAt: Date.now() + TOP_POOL_CACHE_TTL_MS,
      rows: dedupedRows,
    };

    return dedupedRows;
  })();

  topPoolInFlight = {
    limit,
    promise: fetchPromise,
  };

  try {
    const rows = await fetchPromise;
    return rows.slice(0, limit);
  } finally {
    if (topPoolInFlight?.promise === fetchPromise) {
      topPoolInFlight = undefined;
    }
  }
}

function mapVideo(video: {
  videoId: string;
  title: string;
  channelTitle: string | null;
  parsedArtist?: string | null;
  favourited: number | bigint | null;
  description: string | null;
}): VideoRecord {
  const favouritedValue =
    typeof video.favourited === "bigint"
      ? Number(video.favourited)
      : Number(video.favourited ?? 0);

  const inferredChannelTitle = inferArtistFromTitle(video.title);

  const displayArtist =
    video.parsedArtist?.trim() ||
    video.channelTitle ||
    inferredChannelTitle ||
    "Unknown Artist";

  return {
    id: video.videoId,
    title: video.title,
    channelTitle: displayArtist,
    genre: "Rock / Metal",
    favourited: Number.isFinite(favouritedValue) ? favouritedValue : 0,
    description: video.description ?? "Legacy video entry from the retained Yeh database.",
  };
}

function mapStoredVideoToPersistable(video: StoredVideoRow): PersistableVideoRecord {
  return {
    ...mapVideo(video),
  };
}

export function clearCatalogVideoCaches() {
  topPoolCache = undefined;
  topPoolInFlight = undefined;
  newestVideosCache = undefined;
  newestVideosInFlight.clear();
  artistsListCache = undefined;
  artistsListInFlight = undefined;
  relatedVideosCache.clear();
  artistVideosCache.clear();
  artistLetterCache.clear();
  artistLetterInFlight.clear();
  artistLetterPageCache.clear();
  artistLetterPageInFlight.clear();
  genreArtistsCache.clear();
  genreVideosCache.clear();
}

function mapPlaylistVideo(video: {
  playlistItemId: number | bigint | string;
  videoId: string;
  title: string;
  channelTitle: string | null;
  parsedArtist?: string | null;
  favourited: number | bigint | null;
  description: string | null;
}): PlaylistVideoRecord {
  return {
    ...mapVideo(video),
    playlistItemId:
      typeof video.playlistItemId === "bigint"
        ? video.playlistItemId.toString()
        : String(video.playlistItemId),
  };
}

async function getStoredVideoById(videoId: string): Promise<StoredVideoRow | null> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return null;
  }

  const rows = await prisma.$queryRaw<StoredVideoRow[]>`
    SELECT
      id,
      videoId,
      title,
      NULL AS channelTitle,
      favourited,
      description
    FROM videos
    WHERE videoId = ${normalizedVideoId}
      AND videoId REGEXP '^[A-Za-z0-9_-]{11}$'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `;

  debugCatalog("getStoredVideoById", {
    requestedVideoId: videoId,
    normalizedVideoId,
    found: rows.length > 0,
  });

  return rows[0] ?? null;
}

async function hasStoredRelatedCache(videoId: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId || !hasDatabaseUrl()) {
    return false;
  }

  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count
    FROM related
    WHERE videoId = ${normalizedVideoId}
  `;

  const countValue = rows[0]?.count;
  const count = typeof countValue === "bigint" ? Number(countValue) : Number(countValue ?? 0);
  return count > 0;
}

async function checkEmbedPlayability(videoId: string): Promise<VideoAvailability> {
  try {
    const response = await fetch(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1`, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
    });

    if (!response.ok) {
      if ([401, 403, 404, 410].includes(response.status)) {
        return { status: "unavailable", reason: `embed:${response.status}` };
      }

      return { status: "check-failed", reason: `embed:${response.status}` };
    }

    const html = await response.text();

    if (containsAgeRestrictionMarker(html)) {
      return { status: "unavailable", reason: "embed:age-restricted" };
    }

    if (
      /"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"(ERROR|UNPLAYABLE|LOGIN_REQUIRED|CONTENT_CHECK_REQUIRED|AGE_CHECK_REQUIRED)"/i.test(
        html,
      )
    ) {
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

async function fetchOEmbedVideo(videoId: string): Promise<PersistableVideoRecord | null> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return null;
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${normalizedVideoId}`)}&format=json`,
      {
        headers: {
          "User-Agent": "YehThatRocks/1.0",
        },
      },
    );

    if (!response.ok) {
      debugCatalog("fetchOEmbedVideo:response-not-ok", {
        videoId: normalizedVideoId,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as YouTubeOEmbedResponse;
    const title = data.title?.trim() ? normalizePossiblyMojibakeText(data.title) : "";
    const channelTitle = data.author_name?.trim() ? normalizePossiblyMojibakeText(data.author_name) : "";

    if (!title) {
      debugCatalog("fetchOEmbedVideo:missing-title", {
        videoId: normalizedVideoId,
      });
      return null;
    }

    debugCatalog("fetchOEmbedVideo:success", {
      videoId: normalizedVideoId,
      title,
      channelTitle,
    });

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
    debugCatalog("fetchOEmbedVideo:error", {
      videoId: normalizedVideoId,
    });
    return null;
  }
}

async function persistVideoAvailability(video: PersistableVideoRecord, availability: VideoAvailability) {
  const persistedTitle = truncate(normalizePossiblyMojibakeText(video.title), 255);
  const persistedDescription = video.description;
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
      VALUES (
        ${video.id},
        ${persistedTitle},
        ${persistedChannelTitle},
        0,
        ${persistedDescription},
        ${persistedTimestamp},
        ${persistedTimestamp}
      )
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        channelTitle = VALUES(channelTitle),
        description = VALUES(description),
        updated_at = VALUES(updated_at)
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO videos (videoId, title, favourited, description, created_at, updated_at)
      VALUES (
        ${video.id},
        ${persistedTitle},
        0,
        ${persistedDescription},
        ${persistedTimestamp},
        ${persistedTimestamp}
      )
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
    availabilityReason: availability.reason,
  });

  const persistedVideo = await getStoredVideoById(video.id);

  if (!persistedVideo) {
    throw new Error(`Failed to persist video ${video.id}`);
  }

  const existingSiteVideo = await prisma.siteVideo.findFirst({
    where: {
      videoId: persistedVideo.id,
    },
    select: {
      id: true,
    },
  });

  const titleWithReason = truncate(`${persistedTitle} [${availability.reason}]`, 255);

  if (existingSiteVideo) {
    await prisma.siteVideo.update({
      where: {
        id: existingSiteVideo.id,
      },
      data: {
        title: titleWithReason,
        status: availability.status,
      },
    });
  } else {
    await prisma.siteVideo.create({
      data: {
        videoId: persistedVideo.id,
        title: titleWithReason,
        status: availability.status,
        createdAt: new Date(),
      },
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

  await maybePersistRuntimeMetadata(persistedVideo.id, video);

  return persistedVideo;
}

async function persistRelatedVideoCache(videoId: string, relatedIds: string[]) {
  const persistedRelatedIds = Array.from(new Set(relatedIds.filter(Boolean)));
  const effectiveRelatedIds = persistedRelatedIds.length > 0 ? persistedRelatedIds : [videoId];
  const now = new Date();

  await prisma.relatedCache.deleteMany({
    where: {
      videoId,
    },
  });

  await prisma.relatedCache.createMany({
    data: effectiveRelatedIds.map((relatedId) => ({
      videoId,
      related: relatedId,
      createdAt: now,
      updatedAt: now,
    })),
  });

  const reverseCandidateIds = effectiveRelatedIds.filter((relatedId) => relatedId !== videoId);
  if (reverseCandidateIds.length === 0) {
    return;
  }

  const existingVideos = await prisma.video.findMany({
    where: {
      videoId: {
        in: reverseCandidateIds,
      },
    },
    select: {
      videoId: true,
    },
  });

  if (existingVideos.length === 0) {
    return;
  }

  const existingVideoIds = existingVideos
    .map((video) => video.videoId)
    .filter((id): id is string => Boolean(id));

  if (existingVideoIds.length === 0) {
    return;
  }

  const alreadyLinkedBack = await prisma.relatedCache.findMany({
    where: {
      videoId: {
        in: existingVideoIds,
      },
      related: videoId,
    },
    select: {
      videoId: true,
    },
  });

  const linkedBackSet = new Set(alreadyLinkedBack.map((row) => row.videoId).filter(Boolean));
  const reverseLinksToCreate = existingVideoIds
    .filter((existingVideoId) => !linkedBackSet.has(existingVideoId))
    .map((existingVideoId) => ({
      videoId: existingVideoId,
      related: videoId,
      createdAt: now,
      updatedAt: now,
    }));

  if (reverseLinksToCreate.length > 0) {
    await prisma.relatedCache.createMany({
      data: reverseLinksToCreate,
    });
  }
}

async function fetchRelatedYouTubeVideos(videoId: string): Promise<PersistableVideoRecord[]> {
  if (!YOUTUBE_DATA_API_KEY) {
    debugCatalog("fetchRelatedYouTubeVideos:skipped-missing-api-key", { videoId });
    return [];
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("maxResults", "8");
    url.searchParams.set("relatedToVideoId", videoId);
    url.searchParams.set("type", "video");
    url.searchParams.set("key", YOUTUBE_DATA_API_KEY);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "YehThatRocks/1.0",
      },
    });

    if (!response.ok) {
      debugCatalog("fetchRelatedYouTubeVideos:response-not-ok", {
        videoId,
        status: response.status,
      });
      return [];
    }

    const data = (await response.json()) as YouTubeRelatedSearchResponse;

    const mapped = (data.items ?? [])
      .map((item) => {
        const relatedId = normalizeYouTubeVideoId(item.id?.videoId);
        const title = item.snippet?.title?.trim() ? normalizePossiblyMojibakeText(item.snippet.title) : "";

        if (!relatedId || !title || relatedId === videoId) {
          return null;
        }

        return {
          id: relatedId,
          title,
          channelTitle: item.snippet?.channelTitle?.trim()
            ? normalizePossiblyMojibakeText(item.snippet.channelTitle)
            : "YouTube",
          genre: "Rock / Metal",
          favourited: 0,
          description: item.snippet?.description?.trim() || "Related YouTube video discovered via YouTube Data API.",
          thumbnail:
            item.snippet?.thumbnails?.high?.url?.trim() ||
            item.snippet?.thumbnails?.medium?.url?.trim() ||
            item.snippet?.thumbnails?.default?.url?.trim() ||
            getYouTubeThumbnailUrl(relatedId),
        } satisfies PersistableVideoRecord;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    debugCatalog("fetchRelatedYouTubeVideos:success", {
      videoId,
      relatedCount: mapped.length,
    });

    return mapped;
  } catch {
    debugCatalog("fetchRelatedYouTubeVideos:error", { videoId });
    return [];
  }
}

async function hydrateAndPersistVideo(
  videoId: string,
  providedVideo?: PersistableVideoRecord,
  options?: { forceAvailabilityRefresh?: boolean },
): Promise<PersistableVideoRecord | null> {
  if (!hasDatabaseUrl()) {
    return providedVideo ?? (await fetchOEmbedVideo(videoId));
  }

  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    debugCatalog("hydrateAndPersistVideo:invalid-video-id", { videoId });
    return null;
  }

  const existingVideo = await getStoredVideoById(normalizedVideoId);

  if (existingVideo && !options?.forceAvailabilityRefresh) {
    debugCatalog("hydrateAndPersistVideo:local-hit", { videoId: normalizedVideoId });
    return mapStoredVideoToPersistable(existingVideo);
  }

  debugCatalog("hydrateAndPersistVideo:hydrate", {
    videoId: normalizedVideoId,
    hasExistingVideo: Boolean(existingVideo),
    forceAvailabilityRefresh: Boolean(options?.forceAvailabilityRefresh),
  });

  const video = providedVideo ?? (existingVideo ? mapStoredVideoToPersistable(existingVideo) : await fetchOEmbedVideo(normalizedVideoId));

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
  await persistVideoAvailability(video, availability);

  if (availability.status !== "unavailable" && !(await hasStoredRelatedCache(normalizedVideoId))) {
    const relatedVideos = await fetchRelatedYouTubeVideos(normalizedVideoId);
    const availableRelatedIds: string[] = [];

    for (const relatedVideo of relatedVideos) {
      const relatedAvailability = await checkEmbedPlayability(relatedVideo.id);
      await persistVideoAvailability(relatedVideo, relatedAvailability);

      if (relatedAvailability.status === "available") {
        availableRelatedIds.push(relatedVideo.id);
      }
    }

    await persistRelatedVideoCache(normalizedVideoId, availableRelatedIds);
  }

  return video;
}

async function getExternalVideoById(videoId: string): Promise<VideoRecord | null> {
  const video = await hydrateAndPersistVideo(videoId);
  return video;
}

export async function importVideoFromDirectSource(source: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(source);

  if (!normalizedVideoId) {
    return {
      videoId: null,
      decision: {
        allowed: false,
        reason: "invalid-video-id",
        message: "Invalid YouTube URL or video id.",
      } satisfies PlaybackDecision,
    };
  }

  await hydrateAndPersistVideo(normalizedVideoId, undefined, { forceAvailabilityRefresh: true });
  let decision = await getVideoPlaybackDecision(normalizedVideoId);

  // Apply the title-parsing heuristic fallback whenever parsedArtist is absent in the DB.
  // This covers two cases: (a) decision was denied due to missing/weak metadata, and (b) the
  // passthrough already allowed playback (embed available, metadata absent) but the video was
  // marked check-failed — e.g. when the Groq classifier was unavailable. Without this, an
  // admin-imported video with a clear title would remain undiscoverable whenever Groq is down.
  if (hasDatabaseUrl()) {
    const fallbackRows = await prisma.$queryRaw<Array<{ id: number; title: string; parsedArtist: string | null; channelTitle: string | null }>>`
      SELECT id, title, parsedArtist, channelTitle
      FROM videos
      WHERE videoId = ${normalizedVideoId}
      LIMIT 1
    `;

    const fallbackRow = fallbackRows[0];
    const metadataAbsent = fallbackRow && !fallbackRow.parsedArtist?.trim();
    const decisionNeedsHelp =
      !decision.allowed &&
      (decision.reason === "missing-metadata" || decision.reason === "unknown-video-type" || decision.reason === "low-confidence");

    const fallbackMeta =
      fallbackRow && (metadataAbsent || decisionNeedsHelp)
        ? deriveAdminImportFallbackMetadata(fallbackRow.title, fallbackRow.channelTitle)
        : null;

    if (fallbackRow && fallbackMeta) {
      await prisma.$executeRaw`
        UPDATE videos
        SET
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

  return { videoId: normalizedVideoId, decision };
}

function mapArtist(artist: {
  name: string;
  country: string | null;
  genre1: string | null;
}): ArtistRecord {
  return {
    name: artist.name,
    slug: slugify(artist.name),
    country: artist.country ?? "Unknown",
    genre: artist.genre1 ?? "Rock / Metal",
    thumbnailVideoId: undefined,
  };
}

function escapeSqlIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

type TableColumnInfo = { Field: string; Type: string };

const tableColumnsCache = new Map<string, TableColumnInfo[]>();
const tableColumnsInFlight = new Map<string, Promise<TableColumnInfo[]>>();

async function loadTableColumns(tableName: string): Promise<TableColumnInfo[]> {
  const cached = tableColumnsCache.get(tableName);
  if (cached) {
    return cached;
  }

  const inFlight = tableColumnsInFlight.get(tableName);
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
  try {
      const columns = await prisma.$queryRawUnsafe<TableColumnInfo[]>(`SHOW COLUMNS FROM ${tableName}`);
      tableColumnsCache.set(tableName, columns);
      return columns;
  } catch {
      const empty: TableColumnInfo[] = [];
      tableColumnsCache.set(tableName, empty);
      return empty;
  }
  })();

  tableColumnsInFlight.set(tableName, pending);

  try {
    return await pending;
  } finally {
    if (tableColumnsInFlight.get(tableName) === pending) {
      tableColumnsInFlight.delete(tableName);
    }
  }
}

function pickColumn(columns: TableColumnInfo[], names: string[]) {
  for (const name of names) {
    const match = columns.find((column) => column.Field === name);
    if (match) return match;
  }
  return undefined;
}

function mapArtistProjectionRow(row: {
  displayName: string;
  slug: string;
  country: string | null;
  genre: string | null;
  thumbnailVideoId?: string | null;
}) {
  const normalizedThumbnailVideoId = normalizeYouTubeVideoId(row.thumbnailVideoId);

  return {
    name: row.displayName,
    slug: row.slug,
    country: row.country ?? "Unknown",
    genre: row.genre ?? "Rock / Metal",
    thumbnailVideoId: normalizedThumbnailVideoId,
  } satisfies ArtistRecord;
}

function getArtistLetterCache(cacheKey: string) {
  const cached = artistLetterCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    artistLetterCache.delete(cacheKey);
    return undefined;
  }

  return cached.rows;
}

function setArtistLetterCache(cacheKey: string, rows: Array<ArtistRecord & { videoCount: number }>) {
  artistLetterCache.set(cacheKey, {
    expiresAt: Date.now() + ARTIST_LETTER_CACHE_TTL_MS,
    rows,
  });
}

async function hasArtistStatsProjection() {
  const now = Date.now();
  if (
    artistStatsProjectionAvailabilityCache &&
    artistStatsProjectionAvailabilityCache.checkedAt + ARTIST_STATS_TABLE_CACHE_TTL_MS > now
  ) {
    return artistStatsProjectionAvailabilityCache.available;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ Field: string }>>(
      "SHOW COLUMNS FROM artist_stats LIKE 'normalized_artist'",
    );

    const available = rows.length > 0;
    artistStatsProjectionAvailabilityCache = {
      checkedAt: now,
      available,
    };
    return available;
  } catch {
    artistStatsProjectionAvailabilityCache = {
      checkedAt: now,
      available: false,
    };
    return false;
  }
}

async function hasArtistStatsThumbnailColumn() {
  const now = Date.now();
  if (
    artistStatsThumbnailColumnAvailabilityCache &&
    artistStatsThumbnailColumnAvailabilityCache.checkedAt + ARTIST_STATS_TABLE_CACHE_TTL_MS > now
  ) {
    return artistStatsThumbnailColumnAvailabilityCache.available;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ Field: string }>>(
      "SHOW COLUMNS FROM artist_stats LIKE 'thumbnail_video_id'",
    );

    const available = rows.length > 0;
    artistStatsThumbnailColumnAvailabilityCache = {
      checkedAt: now,
      available,
    };
    return available;
  } catch {
    artistStatsThumbnailColumnAvailabilityCache = {
      checkedAt: now,
      available: false,
    };
    return false;
  }
}

async function getArtistStatRow(normalizedArtist: string) {
  if (!(await hasArtistStatsProjection())) {
    return null;
  }

  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
  const rows = await prisma.$queryRawUnsafe<Array<{
    displayName: string | null;
    country: string | null;
    genre: string | null;
    thumbnailVideoId: string | null;
    videoCount: number | null;
  }>>(
    `
      SELECT
        display_name AS displayName,
        country,
        genre,
        ${hasThumbnailColumn ? "thumbnail_video_id" : "NULL"} AS thumbnailVideoId,
        video_count AS videoCount
      FROM artist_stats
      WHERE normalized_artist = ?
      LIMIT 1
    `,
    normalizedArtist,
  );

  return rows[0] ?? null;
}

async function upsertArtistStatsRow(row: {
  name: string;
  country: string | null;
  genre: string | null;
  videoCount: number;
  thumbnailVideoId?: string | null;
}, source: string) {
  if (!(await hasArtistStatsProjection())) {
    return;
  }

  const displayName = row.name.trim();
  if (!displayName) {
    return;
  }

  const normalizedArtist = normalizeArtistKey(displayName);
  const firstLetter = displayName.charAt(0).toUpperCase();
  const slug = slugify(displayName);
  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();

  if (hasThumbnailColumn) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO artist_stats (
          normalized_artist,
          display_name,
          slug,
          first_letter,
          country,
          genre,
          thumbnail_video_id,
          video_count,
          source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          display_name = VALUES(display_name),
          slug = VALUES(slug),
          first_letter = VALUES(first_letter),
          country = VALUES(country),
          genre = VALUES(genre),
          thumbnail_video_id = VALUES(thumbnail_video_id),
          video_count = VALUES(video_count),
          source = VALUES(source)
      `,
      normalizedArtist,
      displayName,
      slug,
      firstLetter,
      row.country,
      row.genre,
      row.thumbnailVideoId ?? null,
      row.videoCount,
      source,
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO artist_stats (
        normalized_artist,
        display_name,
        slug,
        first_letter,
        country,
        genre,
        video_count,
        source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        slug = VALUES(slug),
        first_letter = VALUES(first_letter),
        country = VALUES(country),
        genre = VALUES(genre),
        video_count = VALUES(video_count),
        source = VALUES(source)
    `,
    normalizedArtist,
    displayName,
    slug,
    firstLetter,
    row.country,
    row.genre,
    row.videoCount,
    source,
  );
}

function scheduleArtistStatsLetterBackfill(letter: string, rows: Array<ArtistRecord & { videoCount: number }>) {
  const normalizedLetter = letter.trim().toUpperCase();
  const now = Date.now();
  const cached = artistStatsLetterBackfillCache.get(normalizedLetter);
  if (cached && cached.expiresAt > now) {
    return;
  }

  if (artistStatsLetterBackfillInFlight.has(normalizedLetter)) {
    return;
  }

  const promise = (async () => {
    if (!(await hasArtistStatsProjection())) {
      return;
    }

    for (const row of rows) {
      if (row.videoCount <= 0) {
        continue;
      }

      await upsertArtistStatsRow({
        name: row.name,
        country: row.country,
        genre: row.genre,
        videoCount: row.videoCount,
        thumbnailVideoId: row.thumbnailVideoId,
      }, "runtime-letter-backfill");
    }

    artistStatsLetterBackfillCache.set(normalizedLetter, {
      expiresAt: Date.now() + ARTIST_STATS_LETTER_BACKFILL_TTL_MS,
    });
  })()
    .catch(() => undefined)
    .finally(() => {
      artistStatsLetterBackfillInFlight.delete(normalizedLetter);
    });

  artistStatsLetterBackfillInFlight.set(normalizedLetter, promise);
}

async function refreshArtistProjectionForName(artistName: string) {
  const displayName = artistName.trim();
  if (!displayName) {
    return;
  }

  if (!hasDatabaseUrl()) {
    return;
  }

  if (!(await hasArtistStatsProjection())) {
    return;
  }

  const normalizedArtist = normalizeArtistKey(displayName);
  const cachedRefresh = artistProjectionRefreshCache.get(normalizedArtist);
  if (cachedRefresh && cachedRefresh.expiresAt > Date.now()) {
    return;
  }

  const inFlightRefresh = artistProjectionRefreshInFlight.get(normalizedArtist);
  if (inFlightRefresh) {
    await inFlightRefresh;
    return;
  }

  const refreshPromise = (async () => {
  const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
  const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);

  const statsRows = await prisma.$queryRawUnsafe<Array<{ videoCount: number | null; thumbnailVideoId: string | null }>>(
    `
      SELECT
        COUNT(DISTINCT v.videoId) AS videoCount,
        SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
      FROM videos v
      WHERE ${videoArtistNormExpr} = ?
        AND v.videoId IS NOT NULL
        AND CHAR_LENGTH(v.videoId) = 11
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
    `,
    normalizedArtist,
  );

  const videoCount = Number(statsRows[0]?.videoCount ?? 0);
  if (videoCount <= 0) {
    await prisma.$executeRawUnsafe(
      "DELETE FROM artist_stats WHERE normalized_artist = ?",
      normalizedArtist,
    );
    return;
  }

  const columns = await getArtistColumnMap();
  const artistNameNormExpr = getArtistNameNormalizationExpr("a", columns);
  const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
  const genreExpr =
    columns.genreColumns.length > 0
      ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
      : "NULL";

  const artistMetaRows = await prisma.$queryRawUnsafe<Array<{ country: string | null; genre: string | null }>>(
    `
      SELECT
        ${countrySelect},
        ${genreExpr} AS genre
      FROM artists a
      WHERE ${artistNameNormExpr} = ?
      LIMIT 1
    `,
    normalizedArtist,
  );

  const country = artistMetaRows[0]?.country ?? null;
  const genre = artistMetaRows[0]?.genre ?? null;
  const thumbnailVideoId = statsRows[0]?.thumbnailVideoId ?? null;
  await upsertArtistStatsRow({
    name: displayName,
    country,
    genre,
    videoCount,
    thumbnailVideoId,
  }, "runtime");

  artistProjectionRefreshCache.set(normalizedArtist, {
    expiresAt: Date.now() + ARTIST_PROJECTION_REFRESH_TTL_MS,
  });
  })()
    .catch(() => undefined)
    .finally(() => {
      artistProjectionRefreshInFlight.delete(normalizedArtist);
    });

  artistProjectionRefreshInFlight.set(normalizedArtist, refreshPromise);
  await refreshPromise;
}

function scheduleArtistProjectionRefreshForName(artistName: string) {
  void refreshArtistProjectionForName(artistName).catch(() => undefined);
}

export async function refreshArtistThumbnailForName(artistName: string, badVideoId?: string) {
  const displayName = artistName.trim();
  if (!displayName || !hasDatabaseUrl()) {
    return null;
  }

  if (!(await hasArtistStatsProjection())) {
    return null;
  }

  const normalizedArtist = normalizeArtistKey(displayName);
  const existingStat = await getArtistStatRow(normalizedArtist).catch(() => null);
  const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
  const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
  const bad = typeof badVideoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(badVideoId)
    ? badVideoId
    : null;

  const existingThumbnail = existingStat?.thumbnailVideoId?.trim() ?? null;
  if (existingThumbnail && existingThumbnail !== bad) {
    return existingThumbnail;
  }

  const candidateRows = await prisma.$queryRawUnsafe<Array<{ thumbnailVideoId: string | null }>>(
    `
      SELECT
        SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
      FROM videos v
      WHERE ${videoArtistNormExpr} = ?
        AND v.videoId IS NOT NULL
        AND CHAR_LENGTH(v.videoId) = 11
        ${bad ? "AND v.videoId <> ?" : ""}
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
    `,
    ...(bad ? [normalizedArtist, bad] : [normalizedArtist]),
  );

  const nextThumbnailVideoId = candidateRows[0]?.thumbnailVideoId ?? null;
  const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();

  if (hasThumbnailColumn) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE artist_stats
        SET thumbnail_video_id = ?
        WHERE normalized_artist = ?
      `,
      nextThumbnailVideoId,
      normalizedArtist,
    );
  }

  return nextThumbnailVideoId;
}

async function getArtistColumnMap() {
  if (artistColumnMapCache) {
    return artistColumnMapCache;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM artists");
  const available = new Set(columns.map((column) => column.Field));

  const name = available.has("artist") ? "artist" : available.has("name") ? "name" : "artist";
  const normalizedName = ["artist_name_norm", "artist_norm", "normalized_artist", "name_normalized"].find((column) => available.has(column)) ?? null;
  const country = available.has("country") ? "country" : available.has("origin") ? "origin" : null;
  const genreColumns = ["genre1", "genre2", "genre3", "genre4", "genre5", "genre6"].filter((column) => available.has(column));

  artistColumnMapCache = {
    name,
    normalizedName,
    country,
    genreColumns,
  };

  return artistColumnMapCache;
}

async function getVideoArtistNormalizationColumn() {
  if (videoArtistNormalizationColumnCache !== undefined) {
    return videoArtistNormalizationColumnCache;
  }

  try {
    const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM videos");
    const available = new Set(columns.map((column) => column.Field));
    videoArtistNormalizationColumnCache = [
      "parsed_artist_norm",
      "parsed_artist_normalized",
      "normalized_parsed_artist",
      "parsedArtistNormalized",
    ].find((column) => available.has(column)) ?? null;
  } catch {
    videoArtistNormalizationColumnCache = null;
  }

  return videoArtistNormalizationColumnCache;
}

function getVideoArtistNormalizationExpr(alias: string, normalizedColumn: string | null, options?: { nullToEmpty?: boolean }) {
  const nullToEmpty = options?.nullToEmpty ?? true;

  if (normalizedColumn) {
    const normalizedRef = `${alias}.${escapeSqlIdentifier(normalizedColumn)}`;
    return nullToEmpty ? `COALESCE(${normalizedRef}, '')` : normalizedRef;
  }

  const parsedArtistRef = `${alias}.parsedArtist`;
  return nullToEmpty
    ? `LOWER(TRIM(COALESCE(${parsedArtistRef}, '')))`
    : `LOWER(TRIM(${parsedArtistRef}))`;
}

function getArtistNameNormalizationExpr(alias: string, columns: { name: string; normalizedName: string | null }, options?: { nullToEmpty?: boolean }) {
  const nullToEmpty = options?.nullToEmpty ?? true;

  if (columns.normalizedName) {
    const normalizedRef = `${alias}.${escapeSqlIdentifier(columns.normalizedName)}`;
    return nullToEmpty ? `COALESCE(${normalizedRef}, '')` : normalizedRef;
  }

  const nameRef = `${alias}.${escapeSqlIdentifier(columns.name)}`;
  return nullToEmpty
    ? `LOWER(TRIM(COALESCE(${nameRef}, '')))`
    : `LOWER(TRIM(${nameRef}))`;
}

async function isKnownArtistName(artistName: string) {
  const normalized = artistName.trim().toLowerCase();
  if (!normalized || !hasDatabaseUrl()) {
    return false;
  }

  const now = Date.now();
  const cached = knownArtistMatchCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.known;
  }

  try {
    const columns = await getArtistColumnMap();
    const artistNameNormExpr = getArtistNameNormalizationExpr("a", columns);
    const rows = await prisma.$queryRawUnsafe<Array<{ matchCount: number }>>(
      `
        SELECT COUNT(*) AS matchCount
        FROM artists a
        WHERE ${artistNameNormExpr} = ?
        LIMIT 1
      `,
      normalized,
    );

    const known = Number(rows[0]?.matchCount ?? 0) > 0;
    knownArtistMatchCache.set(normalized, {
      expiresAt: now + KNOWN_ARTIST_MATCH_CACHE_TTL_MS,
      known,
    });
    return known;
  } catch {
    return false;
  }
}

async function getArtistVideoColumnMap() {
  if (artistVideoColumnMapCache) {
    return artistVideoColumnMapCache;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>("SHOW COLUMNS FROM videosbyartist");
  const available = new Set(columns.map((column) => column.Field));
  const typeByField = new Map(columns.map((column) => [column.Field, column.Type.toLowerCase()]));

  const artistName = available.has("artist")
    ? "artist"
    : available.has("artistname")
      ? "artistname"
      : available.has("artist_name")
        ? "artist_name"
        : "artist";
  const normalizedArtistName = ["artist_name_norm", "artist_norm", "normalized_artist"].find((column) => available.has(column)) ?? null;

  const videoRef = available.has("video_id")
    ? "video_id"
    : available.has("videoId")
      ? "videoId"
      : available.has("videoid")
        ? "videoid"
        : "videoId";

  const videoRefType = typeByField.get(videoRef) ?? "";
  const joinsOnVideoPrimaryId = videoRef === "video_id" || /(int|bigint|smallint|tinyint)/i.test(videoRefType);

  artistVideoColumnMapCache = {
    artistName,
    normalizedArtistName,
    videoRef,
    joinsOnVideoPrimaryId,
  };

  return artistVideoColumnMapCache;
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
    new Set(
      matchingRows
        .map((row) => row.parsedArtist?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const [siteVideoColumns, playlistColumns, favouriteColumns, artistVideoColumns, messageColumns, relatedColumns] = await Promise.all([
    loadTableColumns("site_videos"),
    loadTableColumns("playlistitems"),
    loadTableColumns("favourites"),
    loadTableColumns("videosbyartist"),
    loadTableColumns("messages"),
    loadTableColumns("related"),
  ]);

  const executeWithRetry = async (query: string, params: unknown[]) => {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await prisma.$executeRawUnsafe(query, ...params);
        return true;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? "");
        const lockError =
          code === "P2010" && (message.includes("1205") || message.includes("1213"));

        if (!lockError || attempt === maxAttempts) {
          throw error;
        }

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
        await executeWithRetry(
          `DELETE FROM playlistitems WHERE ${escapeSqlIdentifier(playlistRef.Field)} = ?`,
          [normalizedVideoId],
        );
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
        await executeWithRetry(
          `DELETE FROM favourites WHERE ${escapeSqlIdentifier(favouriteRef.Field)} = ?`,
          [normalizedVideoId],
        );
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
        await executeWithRetry(
          `DELETE FROM videosbyartist WHERE ${escapeSqlIdentifier(artistVideoRef.Field)} = ?`,
          [normalizedVideoId],
        );
      }
    }

    const messageRef = pickColumn(messageColumns, ["video_id", "videoId"]);
    if (messageRef) {
      await executeWithRetry(
        `DELETE FROM messages WHERE ${escapeSqlIdentifier(messageRef.Field)} = ?`,
        [normalizedVideoId],
      );
    }

    const relatedVideoRef = pickColumn(relatedColumns, ["video_id", "videoId"]);
    const relatedRelatedRef = pickColumn(relatedColumns, ["related_video", "related"]);
    if (relatedVideoRef && relatedRelatedRef) {
      await executeWithRetry(
        `DELETE FROM related WHERE ${escapeSqlIdentifier(relatedVideoRef.Field)} = ? OR ${escapeSqlIdentifier(relatedRelatedRef.Field)} = ?`,
        [normalizedVideoId, normalizedVideoId],
      );
    } else if (relatedVideoRef) {
      await executeWithRetry(
        `DELETE FROM related WHERE ${escapeSqlIdentifier(relatedVideoRef.Field)} = ?`,
        [normalizedVideoId],
      );
    } else if (relatedRelatedRef) {
      await executeWithRetry(
        `DELETE FROM related WHERE ${escapeSqlIdentifier(relatedRelatedRef.Field)} = ?`,
        [normalizedVideoId],
      );
    }

    await executeWithRetry(
      `DELETE FROM videos WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
  } catch {
    const siteVideoRef = pickColumn(siteVideoColumns, ["video_id", "videoId"]);
    if (siteVideoRef) {
      try {
        await executeWithRetry(
          `UPDATE site_videos SET status = 'unavailable' WHERE ${escapeSqlIdentifier(siteVideoRef.Field)} IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      } catch {
        // best-effort fallback only
      }
    }

    return { pruned: false, deletedVideoRows: 0, reason: "lock-timeout-marked-unavailable" };
  }

  await clearGenreCardThumbnailForVideo(normalizedVideoId);

  // Reset hot caches so lists immediately reflect the prune.
  clearCatalogVideoCaches();

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

async function getArtistVideoStatsSource() {
  if (artistVideoStatsSourceCache) {
    return artistVideoStatsSourceCache;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ hasRows: number }>>(
      "SELECT EXISTS(SELECT 1 FROM videosbyartist LIMIT 1) AS hasRows",
    );

    artistVideoStatsSourceCache = Number(rows[0]?.hasRows ?? 0) > 0 ? "videosbyartist" : "parsedArtist";
  } catch {
    artistVideoStatsSourceCache = "parsedArtist";
  }

  return artistVideoStatsSourceCache;
}

async function findArtistsInDatabase(options: {
  limit: number;
  search?: string;
  orderByName?: boolean;
  prefixOnly?: boolean;
  nameOnly?: boolean;
}) {
  const { limit, search, orderByName, prefixOnly, nameOnly } = options;
  const columns = await getArtistColumnMap();
  const normalizedSearch = search?.trim() ?? "";

  const nameCol = escapeSqlIdentifier(columns.name);
  const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
  const genreExpr =
    columns.genreColumns.length > 0
      ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
      : "NULL";

  const whereParts: string[] = [];
  const params: string[] = [];

  if (normalizedSearch) {
    const needle = prefixOnly ? `${normalizedSearch}%` : `%${normalizedSearch}%`;
    whereParts.push(`a.${nameCol} LIKE ?`);
    params.push(needle);

    if (!nameOnly && columns.country) {
      whereParts.push(`a.${escapeSqlIdentifier(columns.country)} LIKE ?`);
      params.push(needle);
    }

    if (!nameOnly) {
      for (const genreColumn of columns.genreColumns) {
        whereParts.push(`a.${escapeSqlIdentifier(genreColumn)} LIKE ?`);
        params.push(needle);
      }
    }
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" OR ")}` : "";
  const orderSql = orderByName ? `ORDER BY a.${nameCol} ASC` : "";
  const cappedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const searchCacheKey = `s:${normalizedSearch}|l:${cappedLimit}|o:${orderByName ? 1 : 0}|p:${prefixOnly ? 1 : 0}|n:${nameOnly ? 1 : 0}`;

  const executeQuery = () => prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
      `
        SELECT
          a.${nameCol} AS name,
          ${countrySelect},
          ${genreExpr} AS genre1
        FROM artists a
        ${whereSql}
        ${orderSql}
        LIMIT ${cappedLimit}
      `,
      ...params,
    );

  if (!normalizedSearch) {
    return executeQuery();
  }

  const now = Date.now();
  const cached = artistSearchCache.get(searchCacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.rows.map((row) => ({ ...row }));
  }

  const inFlight = artistSearchInFlight.get(searchCacheKey);
  if (inFlight) {
    const rows = await inFlight;
    return rows.map((row) => ({ ...row }));
  }

  const pending = executeQuery();
  artistSearchInFlight.set(searchCacheKey, pending);

  try {
    const rows = await pending;
    artistSearchCache.set(searchCacheKey, {
      expiresAt: Date.now() + ARTIST_SEARCH_CACHE_TTL_MS,
      rows,
    });
    return rows;
  } finally {
    if (artistSearchInFlight.get(searchCacheKey) === pending) {
      artistSearchInFlight.delete(searchCacheKey);
    }
  }
}

export async function getCurrentVideo(videoId?: string, options?: { skipPlaybackDecision?: boolean }) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  debugCatalog("getCurrentVideo:start", {
    inputVideoId: videoId,
    normalizedVideoId,
    hasDatabase: hasDatabaseUrl(),
  });

  if (!hasDatabaseUrl()) {
    return null;
  }

  try {
    if (normalizedVideoId && !options?.skipPlaybackDecision) {
      const decision = await getVideoPlaybackDecision(normalizedVideoId);
      if (!decision.allowed) {
        if (decision.reason === "unavailable") {
          await pruneVideoAndAssociationsByVideoId(normalizedVideoId, "playback-decision-unavailable").catch(() => undefined);
        }
        debugCatalog("getCurrentVideo:denied-requested-video", {
          videoId: normalizedVideoId,
          reason: decision.reason,
        });
        return null;
      }
    }

    if (normalizedVideoId) {
      const storedVideo = await getStoredVideoById(normalizedVideoId);

      if (storedVideo) {
        debugCatalog("getCurrentVideo:return-local-video", {
          videoId: normalizedVideoId,
        });
        return mapVideo(storedVideo);
      }
    }

    const videos = normalizedVideoId
      ? await prisma.$queryRaw<
          RankedVideoRow[]
        >`
          SELECT
            videoId,
            title,
            NULL AS channelTitle,
            favourited,
            description
          FROM videos
          WHERE videoId = ${normalizedVideoId}
            AND videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = videos.id
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = videos.id
                AND (sv.status IS NULL OR sv.status <> 'available')
            )
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `
      : await (async () => {
          // Pick randomly from the top-50 most-favourited videos so the initial
          // load varies rather than always landing on the single highest-ranked video.
          const pool = await getRankedTopPool(50);
          if (pool.length === 0) return pool;
          const randomIndex = Math.floor(Math.random() * pool.length);
          return [pool[randomIndex]];
        })();

    const video = videos[0];

    if (video) {
      debugCatalog("getCurrentVideo:return-query-video", {
        videoId: video.videoId,
      });
      return mapVideo(video);
    }

    debugCatalog("getCurrentVideo:return-seed-video", {
      videoId: normalizedVideoId,
      reason: "no-query-hit",
    });

    return null;
  } catch {
    debugCatalog("getCurrentVideo:return-seed-video-after-error", {
      videoId: normalizedVideoId,
    });

    return null;
  }
}

export async function getVideoForSharing(videoId?: string) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return null;
  }

  if (!hasDatabaseUrl()) {
    const seedVideo = getSeedVideoById(normalizedVideoId);
    return seedVideo?.id === normalizedVideoId ? seedVideo : null;
  }

  try {
    const rows = await prisma.$queryRaw<Array<RankedVideoRow>>`
      SELECT
        videoId,
        title,
        NULL AS channelTitle,
        parsedArtist,
        favourited,
        description
      FROM videos
      WHERE videoId = ${normalizedVideoId}
        AND videoId REGEXP '^[A-Za-z0-9_-]{11}$'
      ORDER BY
        CASE
          WHEN parsedArtist IS NULL OR TRIM(parsedArtist) = '' THEN 1
          ELSE 0
        END ASC,
        id DESC
      LIMIT 1
    `;

    const row = rows[0];

    if (row) {
      return mapVideo(row);
    }

    const seedVideo = getSeedVideoById(normalizedVideoId);
    return seedVideo?.id === normalizedVideoId ? seedVideo : null;
  } catch {
    const seedVideo = getSeedVideoById(normalizedVideoId);
    return seedVideo?.id === normalizedVideoId ? seedVideo : null;
  }
}

export async function getVideoPlaybackDecision(videoId?: string): Promise<PlaybackDecision> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  if (!normalizedVideoId) {
    return {
      allowed: false,
      reason: "invalid-video-id",
      message: "Sorry, that video cannot be played on YehThatRocks.",
    };
  }

  if (!hasDatabaseUrl()) {
    return { allowed: true, reason: "ok" };
  }

  const cachedDecision = playbackDecisionCache.get(normalizedVideoId);
  const now = Date.now();
  if (cachedDecision && cachedDecision.expiresAt > now) {
    return cachedDecision.decision;
  }

  const fetchDecisionRows = async () =>
    prisma.$queryRaw<Array<PlaybackDecisionRow>>`
    SELECT
      v.id,
      v.title,
      v.description,
      v.parsedArtist,
      v.parsedTrack,
      v.parsedVideoType,
      v.parseConfidence,
      EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      ) AS hasAvailable,
      EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND (sv.status IS NULL OR sv.status <> 'available')
      ) AS hasBlocked
    FROM videos v
    WHERE v.videoId = ${normalizedVideoId}
    ORDER BY hasAvailable DESC, hasBlocked ASC, v.updated_at DESC, v.id DESC
    LIMIT 1
  `;

  let row = (await fetchDecisionRows())[0];
  let hydratedFromDirectRequest = false;

  if (!row) {
    const hydrated = await hydrateAndPersistVideo(normalizedVideoId);

    if (!hydrated) {
      const decision: PlaybackDecision = {
        allowed: false,
        reason: "not-found",
        message: "Sorry, that video cannot be played on YehThatRocks.",
      };
      playbackDecisionCache.set(normalizedVideoId, {
        expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
        decision,
      });
      return decision;
    }

    row = (await fetchDecisionRows())[0];
    hydratedFromDirectRequest = true;

    if (!row) {
      const decision: PlaybackDecision = {
        allowed: false,
        reason: "not-found",
        message: "Sorry, that video cannot be played on YehThatRocks.",
      };
      playbackDecisionCache.set(normalizedVideoId, {
        expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
        decision,
      });
      return decision;
    }
  }

  // Check availability status first.
  // If at least one available row exists, direct playback should be allowed even if
  // stale non-available rows also exist for the same video.
  if (!Boolean(row.hasAvailable)) {
    if (!hydratedFromDirectRequest) {
      await hydrateAndPersistVideo(normalizedVideoId, undefined, { forceAvailabilityRefresh: true });
      row = (await fetchDecisionRows())[0] ?? row;
    }

    if (Boolean(row.hasAvailable)) {
      // Video is available, but allow it through before metadata validation.
      // Metadata will be backfilled asynchronously below.
    } else {
      const decision: PlaybackDecision = {
        allowed: false,
        reason: "unavailable",
        message: "Sorry, that video cannot be played on YehThatRocks.",
      };
      playbackDecisionCache.set(normalizedVideoId, {
        expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
        decision,
      });
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

  // Direct-link playback should never hard-fail when YouTube embed is available.
  // If metadata classification is weak, allow playback but keep the video out of
  // promoted "available" pools by marking the site entry as check-failed.
  if (
    !decision.allowed
    && Boolean(row.hasAvailable)
    && !Boolean(row.hasBlocked)
    && (decision.reason === "missing-metadata" || decision.reason === "unknown-video-type" || decision.reason === "low-confidence")
  ) {
    await prisma.siteVideo.updateMany({
      where: {
        videoId: row.id,
      },
      data: {
        status: "check-failed",
        title: truncate(`${row.title} [metadata-gate:${decision.reason}]`, 255),
      },
    });

    const passthroughDecision: PlaybackDecision = { allowed: true, reason: "ok" };
    playbackDecisionCache.set(normalizedVideoId, {
      expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
      decision: passthroughDecision,
    });

    return passthroughDecision;
  }

  playbackDecisionCache.set(normalizedVideoId, {
    expiresAt: now + PLAYBACK_DECISION_CACHE_TTL_MS,
    decision,
  });
  return decision;
}

export async function getRelatedVideos(
  videoId: string,
  options?: { userId?: number; count?: number; excludeVideoIds?: string[] },
) {
  const requestedCount = Math.max(1, Math.min(120, Math.floor(options?.count ?? 10)));
  const excludedIds = new Set(
    (options?.excludeVideoIds ?? [])
      .map((id) => normalizeYouTubeVideoId(id) ?? id)
      .filter((id): id is string => Boolean(id)),
  );
  const baseBlockedIds = new Set<string>([videoId, ...excludedIds]);
  const useCachedDefaultQuery = excludedIds.size === 0 && requestedCount === 10;

  if (!hasDatabaseUrl()) {
    const seen = new Set<string>();
    return getSeedRelatedVideos(videoId)
      .filter((video) => {
        if (baseBlockedIds.has(video.id) || seen.has(video.id)) {
          return false;
        }

        seen.add(video.id);
        return true;
      })
      .slice(0, requestedCount);
  }

  const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;
  baseBlockedIds.add(normalizedVideoId);
  const now = Date.now();
  const cacheKey = options?.userId ? `${normalizedVideoId}:u:${options.userId}` : normalizedVideoId;
  if (useCachedDefaultQuery) {
    const cached = relatedVideosCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.videos;
    }

    const inFlight = relatedVideosInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const resolveRelatedVideos = async () => {

  try {
    const queryTimeoutMs = 4_500;
    const targetCount = requestedCount;
    const timeBucket = Math.floor(now / (15 * 60 * 1000));
    const rotationSeed = `${normalizedVideoId}:${options?.userId ?? "anon"}:${timeBucket}`;

    const currentRows = await prisma.$queryRaw<Array<{ parsedArtist: string | null }>>`
      SELECT parsedArtist
      FROM videos
      WHERE videoId = ${normalizedVideoId}
      LIMIT 1
    `;

    const currentArtist = currentRows[0]?.parsedArtist?.trim() || null;
    const currentArtistNormalized = currentArtist ? normalizeArtistKey(currentArtist) : null;
    const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);

    // Fetch watch history and favourites in parallel with candidate queries.
    // Seen videos are excluded unless they are in the user's favourites.
    const watchedIdsPromise = options?.userId
      ? fetchRecentlyWatchedIds(options.userId)
      : Promise.resolve(new Set<string>());
    const favouriteIdsPromise = options?.userId
      ? fetchFavouriteVideoIds(options.userId)
      : Promise.resolve(new Set<string>());

    const [dbQueryResult, watchedIds, favouriteIds] = await Promise.all([
      withSoftTimeout(
        `getRelatedVideos:${normalizedVideoId}`,
        queryTimeoutMs,
        async () => {
        const topPromise = getRankedTopPool(200);

        const directRelatedPromise = prisma.$queryRaw<RankedVideoRow[]>`
          SELECT
            v.videoId,
            v.title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            v.favourited,
            v.description
          FROM related r
          INNER JOIN videos v ON v.videoId = r.related
          WHERE r.videoId = ${normalizedVideoId}
            AND r.related <> ${normalizedVideoId}
            AND v.videoId IS NOT NULL
            AND CHAR_LENGTH(v.videoId) = 11
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
          GROUP BY v.videoId, v.title, v.parsedArtist, v.favourited, v.description
          ORDER BY v.favourited DESC, MAX(COALESCE(v.viewCount, 0)) DESC, v.videoId ASC
          LIMIT 36
        `;

        const sameArtistPromise = currentArtistNormalized
          ? prisma.$queryRawUnsafe<RankedVideoRow[]>(
              `
                SELECT
                  v.videoId,
                  v.title,
                  COALESCE(v.parsedArtist, NULL) AS channelTitle,
                  v.favourited,
                  v.description
                FROM videos v
                WHERE ${videoArtistNormExpr} = ?
                  AND v.videoId <> ?
                  AND v.videoId IS NOT NULL
                  AND CHAR_LENGTH(v.videoId) = 11
                  AND EXISTS (
                    SELECT 1
                    FROM site_videos sv
                    WHERE sv.video_id = v.id
                      AND sv.status = 'available'
                  )
                ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id DESC
                LIMIT 36
              `,
              currentArtistNormalized,
              normalizedVideoId,
            )
          : Promise.resolve([] as RankedVideoRow[]);

        const newestPromise =
          newestVideosCache && newestVideosCache.expiresAt > now && newestVideosCache.rows.length >= 50
            ? Promise.resolve(newestVideosCache.rows.slice(0, 50))
            : prisma.$queryRaw<RankedVideoRow[]>`
                SELECT
                  v.videoId,
                  v.title,
                  COALESCE(v.parsedArtist, NULL) AS channelTitle,
                  v.favourited,
                  v.description
                FROM videos v
                WHERE v.videoId <> ${normalizedVideoId}
                  AND v.videoId IS NOT NULL
                  AND CHAR_LENGTH(v.videoId) = 11
                  AND EXISTS (
                    SELECT 1
                    FROM site_videos sv
                    WHERE sv.video_id = v.id
                      AND sv.status = 'available'
                  )
                ORDER BY v.updated_at DESC, v.created_at DESC, v.id DESC
                LIMIT 50
              `;

        const sameGenrePromise = (async () => {
          if (!ENABLE_SAME_GENRE_RELATED) {
            return [] as RankedVideoRow[];
          }

          if (!currentArtist || !currentArtistNormalized) {
            return [] as RankedVideoRow[];
          }

          const artistColumns = await getArtistColumnMap();
          if (artistColumns.genreColumns.length === 0) {
            return [] as RankedVideoRow[];
          }

          const artistNameNormExpr = getArtistNameNormalizationExpr("a", artistColumns);
          const videoArtistNormExprNullable = getVideoArtistNormalizationExpr("v", videoArtistNormColumn, { nullToEmpty: false });
          const genreExpr = `COALESCE(${artistColumns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`;

          const currentArtistGenreRows = await prisma.$queryRawUnsafe<Array<{ genre: string | null }>>(
            `
              SELECT ${genreExpr} AS genre
              FROM artists a
              WHERE ${artistNameNormExpr} = ?
              LIMIT 1
            `,
            currentArtistNormalized,
          );

          const genre = currentArtistGenreRows[0]?.genre?.trim();
          if (!genre) {
            return [] as RankedVideoRow[];
          }

          const genrePredicate = artistColumns.genreColumns
            .map((column) => `a.${escapeSqlIdentifier(column)} LIKE CONCAT('%', ?, '%')`)
            .join(" OR ");
          const genreParams = artistColumns.genreColumns.map(() => genre);

          return prisma.$queryRawUnsafe<RankedVideoRow[]>(
            `
              SELECT /*+ MAX_EXECUTION_TIME(800) */
                v.videoId,
                v.title,
                COALESCE(v.parsedArtist, NULL) AS channelTitle,
                v.favourited,
                v.description
              FROM videos v
              WHERE v.videoId <> ?
                AND v.videoId IS NOT NULL
                AND CHAR_LENGTH(v.videoId) = 11
                AND ${videoArtistNormExpr} <> ?
                AND EXISTS (
                  SELECT 1
                  FROM artists a
                  WHERE ${artistNameNormExpr} = ${videoArtistNormExprNullable}
                    AND (${genrePredicate})
                )
                AND EXISTS (
                  SELECT 1
                  FROM site_videos sv
                  WHERE sv.video_id = v.id
                    AND sv.status = 'available'
                )
              ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id DESC
              LIMIT 40
            `,
            normalizedVideoId,
            currentArtistNormalized,
            ...genreParams,
          );
        })();

        const [topRows, directRows, artistRows, recentRows, genreRows] = await Promise.all([
          topPromise,
          directRelatedPromise,
          sameArtistPromise,
          newestPromise,
          sameGenrePromise,
        ]);

        return [
          directRows,
          artistRows,
          recentRows,
          topRows,
          genreRows,
        ] as const;
      },
      ),
      watchedIdsPromise,
      favouriteIdsPromise,
    ]);

    const [directRelatedRows, sameArtistRows, newestRows, topPoolRows, sameGenreRows] = dbQueryResult;

    // Prefer unseen videos first. If we cannot reach targetCount, relax watched exclusion
    // so the rail can still fill toward its max size.
    const watchedIdsToExclude = new Set(
      Array.from(watchedIds).filter((videoId) => !favouriteIds.has(videoId)),
    );
    const strictBlockedIds = new Set<string>([normalizedVideoId, ...watchedIdsToExclude, ...excludedIds]);
    const assembledRows: RankedVideoRow[] = [];

    const buckets = [
      { rows: rotateRowsBySeed(dedupeRankedRows(directRelatedRows), `${rotationSeed}:direct`), quota: 3 },
      { rows: rotateRowsBySeed(dedupeRankedRows(sameArtistRows), `${rotationSeed}:artist`), quota: 2 },
      { rows: rotateRowsBySeed(dedupeRankedRows(sameGenreRows), `${rotationSeed}:genre`), quota: 2 },
      { rows: rotateRowsBySeed(dedupeRankedRows(newestRows), `${rotationSeed}:new`), quota: 2 },
      { rows: rotateRowsBySeed(dedupeRankedRows(topPoolRows), `${rotationSeed}:top`), quota: 2 },
    ];

    for (const bucket of buckets) {
      assembledRows.push(...selectUniqueVideoRows(bucket.rows, strictBlockedIds, bucket.quota));
      if (assembledRows.length >= targetCount) {
        break;
      }
    }

    const overflowPool = dedupeRankedRows(buckets.flatMap((bucket) => bucket.rows));

    if (assembledRows.length < targetCount) {
      assembledRows.push(...selectUniqueVideoRows(overflowPool, strictBlockedIds, targetCount - assembledRows.length));
    }

    if (assembledRows.length < targetCount && watchedIds.size > 0) {
      const relaxedBlockedIds = new Set<string>([
        normalizedVideoId,
        ...excludedIds,
        ...assembledRows.map((row) => row.videoId),
      ]);
      assembledRows.push(...selectUniqueVideoRows(overflowPool, relaxedBlockedIds, targetCount - assembledRows.length));
    }

    if (assembledRows.length < targetCount) {
      const remaining = targetCount - assembledRows.length;
      const backfillPool = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT
          v.videoId,
          v.title,
          COALESCE(v.parsedArtist, NULL) AS channelTitle,
          v.favourited,
          v.description
        FROM videos v
        WHERE v.videoId IS NOT NULL
          AND CHAR_LENGTH(v.videoId) = 11
          AND EXISTS (
            SELECT 1
            FROM site_videos sv
            WHERE sv.video_id = v.id
              AND sv.status = 'available'
          )
        ORDER BY v.updated_at DESC, v.created_at DESC, v.id DESC
        LIMIT ${Math.max(remaining * 6, 300)}
      `;

      const backfillBlockedIds = new Set<string>([
        normalizedVideoId,
        ...excludedIds,
        ...assembledRows.map((row) => row.videoId),
      ]);
      assembledRows.push(...selectUniqueVideoRows(dedupeRankedRows(backfillPool), backfillBlockedIds, remaining));
    }

    const mapped = assembledRows.slice(0, targetCount).map(mapVideo);
    if (useCachedDefaultQuery) {
      relatedVideosCache.set(cacheKey, {
        expiresAt: now + RELATED_VIDEOS_CACHE_TTL_MS,
        videos: mapped,
      });
    }

    return mapped;
  } catch {
    try {
      const fallbackPool = await getRankedTopPool(Math.max(requestedCount + 20, 120));
      return dedupeRankedRows(fallbackPool)
        .filter((row) => row.videoId !== normalizedVideoId && !baseBlockedIds.has(row.videoId))
        .slice(0, requestedCount)
        .map(mapVideo);
    } catch {
      return [];
    }
  }
  };

  if (!useCachedDefaultQuery) {
    return resolveRelatedVideos();
  }

  const pending = resolveRelatedVideos();
  relatedVideosInFlight.set(cacheKey, pending);

  try {
    return await pending;
  } finally {
    if (relatedVideosInFlight.get(cacheKey) === pending) {
      relatedVideosInFlight.delete(cacheKey);
    }
  }
}

export async function getTopVideos(count = 100) {
  if (!hasDatabaseUrl()) {
    return [];
  }

  try {
    const videos = await getRankedTopPool(Math.max(count, 1));

    return videos.length > 0 ? videos.slice(0, count).map(mapVideo) : [];
  } catch {
    return [];
  }
}

async function filterPlayableNewestRows(rows: RankedVideoRow[], targetCount: number) {
  if (rows.length === 0) {
    return rows;
  }

  const playableRows: RankedVideoRow[] = [];

  for (const row of rows) {
    const decision = await getVideoPlaybackDecision(row.videoId);

    if (decision.allowed) {
      playableRows.push(row);
    } else if (decision.reason === "unavailable") {
      await pruneVideoAndAssociationsByVideoId(row.videoId, "newest-preflight-unavailable").catch(() => undefined);
    }

    if (playableRows.length >= targetCount) {
      break;
    }
  }

  return playableRows;
}

export async function getNewestVideos(
  count = 20,
  offset = 0,
  options?: {
    enforcePlaybackAvailability?: boolean;
  },
) {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const safeCount = Math.max(1, Math.min(500, Math.floor(count)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const now = Date.now();

  if (
    newestVideosCache
    && newestVideosCache.expiresAt > now
    && newestVideosCache.count >= safeCount + safeOffset
    && safeOffset === 0
  ) {
    return newestVideosCache.rows.slice(0, safeCount).map(mapVideo);
  }

  const newestRequestKey = `${safeCount}:${safeOffset}:${options?.enforcePlaybackAvailability ? "1" : "0"}`;
  const inFlightNewest = newestVideosInFlight.get(newestRequestKey);
  if (inFlightNewest) {
    return inFlightNewest;
  }

  const resolveNewestVideos = async () => {
    try {
      const videos = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT
          v.videoId,
          v.title,
          NULL AS channelTitle,
          v.parsedArtist,
          v.favourited,
          v.description
        FROM videos v
        WHERE v.videoId IS NOT NULL
          AND CHAR_LENGTH(v.videoId) = 11
          AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        ORDER BY v.updated_at DESC, v.created_at DESC, v.id DESC
        LIMIT ${safeCount}
        OFFSET ${safeOffset}
      `;

      if (videos.length > 0) {
        const effectiveRows = options?.enforcePlaybackAvailability
          ? await filterPlayableNewestRows(videos, safeCount)
          : videos;

        if (safeOffset === 0) {
          newestVideosCache = {
            expiresAt: now + NEWEST_CACHE_TTL_MS,
            count: effectiveRows.length,
            rows: effectiveRows,
          };
        }

        return effectiveRows.map(mapVideo);
      }

      const fallbackByMappedTimestamps = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT
          v.videoId,
          v.title,
          NULL AS channelTitle,
          v.parsedArtist,
          v.favourited,
          v.description
        FROM videos v
        WHERE v.videoId IS NOT NULL
          AND CHAR_LENGTH(v.videoId) = 11
        ORDER BY v.updated_at DESC, v.created_at DESC, v.id DESC
        LIMIT ${safeCount}
        OFFSET ${safeOffset}
      `;

      if (fallbackByMappedTimestamps.length > 0) {
        const effectiveRows = options?.enforcePlaybackAvailability
          ? await filterPlayableNewestRows(fallbackByMappedTimestamps, safeCount)
          : fallbackByMappedTimestamps;

        if (safeOffset === 0) {
          newestVideosCache = {
            expiresAt: now + NEWEST_CACHE_TTL_MS,
            count: effectiveRows.length,
            rows: effectiveRows,
          };
        }

        return effectiveRows.map(mapVideo);
      }

      const fallbackByLegacyTimestamps = await prisma.$queryRaw<RankedVideoRow[]>`
        SELECT
          v.videoId,
          v.title,
          NULL AS channelTitle,
          v.favourited,
          v.description
        FROM videos v
        WHERE v.videoId IS NOT NULL
          AND CHAR_LENGTH(v.videoId) = 11
        ORDER BY COALESCE(v.updatedAt, v.createdAt) DESC, v.id DESC
        LIMIT ${safeCount}
        OFFSET ${safeOffset}
      `;

      const effectiveLegacyRows = options?.enforcePlaybackAvailability
        ? await filterPlayableNewestRows(fallbackByLegacyTimestamps, safeCount)
        : fallbackByLegacyTimestamps;

      if (safeOffset === 0 && effectiveLegacyRows.length > 0) {
        newestVideosCache = {
          expiresAt: now + NEWEST_CACHE_TTL_MS,
          count: effectiveLegacyRows.length,
          rows: effectiveLegacyRows,
        };
      }

      return effectiveLegacyRows.map(mapVideo);
    } catch {
      try {
        const fallbackRows = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `
            SELECT
              videoId,
              title,
              NULL AS channelTitle,
              favourited,
              description
            FROM videos
            WHERE videoId IS NOT NULL
              AND CHAR_LENGTH(videoId) = 11
            ORDER BY id DESC
            LIMIT ?
            OFFSET ?
          `,
          safeCount,
          safeOffset,
        );

        const effectiveRows = options?.enforcePlaybackAvailability
          ? await filterPlayableNewestRows(fallbackRows, safeCount)
          : fallbackRows;

        if (safeOffset === 0 && effectiveRows.length > 0) {
          newestVideosCache = {
            expiresAt: now + NEWEST_CACHE_TTL_MS,
            count: effectiveRows.length,
            rows: effectiveRows,
          };
        }

        return effectiveRows.map(mapVideo);
      } catch {
        return [];
      }
    }
  };

  const pendingNewest = resolveNewestVideos();
  newestVideosInFlight.set(newestRequestKey, pendingNewest);

  try {
    return await pendingNewest;
  } finally {
    if (newestVideosInFlight.get(newestRequestKey) === pendingNewest) {
      newestVideosInFlight.delete(newestRequestKey);
    }
  }
}

export async function getUnseenCatalogVideos(options?: {
  userId?: number;
  count?: number;
  excludeVideoIds?: string[];
}) {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const requested = Math.max(1, Math.min(500, Math.floor(options?.count ?? 100)));
  const fetchLimit = Math.min(1500, Math.max(requested * 3, requested + 100));
  const excluded = new Set(
    (options?.excludeVideoIds ?? [])
      .map((id) => normalizeYouTubeVideoId(id) ?? id)
      .filter((id): id is string => Boolean(id)),
  );

  try {
    const rows = options?.userId
      ? await prisma.$queryRaw<RankedVideoRow[]>`
          SELECT
            v.videoId,
            v.title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            v.favourited,
            v.description
          FROM videos v
          WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM watch_history wh
              WHERE wh.user_id = ${options.userId}
                AND wh.video_id = v.videoId
            )
          ORDER BY v.updated_at DESC, v.created_at DESC, v.id DESC
          LIMIT ${fetchLimit}
        `
      : await prisma.$queryRaw<RankedVideoRow[]>`
          SELECT
            v.videoId,
            v.title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            v.favourited,
            v.description
          FROM videos v
          WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
          ORDER BY v.updated_at DESC, v.created_at DESC, v.id DESC
          LIMIT ${fetchLimit}
        `;

    const seen = new Set<string>();
    const result = rows
      .filter((row) => {
        if (!row.videoId || excluded.has(row.videoId) || seen.has(row.videoId)) {
          return false;
        }
        seen.add(row.videoId);
        return true;
      })
      .slice(0, requested)
      .map(mapVideo);

    return result;
  } catch {
    return [];
  }
}

export async function getArtists() {
  if (!hasDatabaseUrl()) {
    return seedArtists;
  }

  const now = Date.now();
  if (artistsListCache && artistsListCache.expiresAt > now) {
    return artistsListCache.rows;
  }

  if (artistsListInFlight) {
    return artistsListInFlight;
  }

  const resolveArtists = async () => {
    try {
      if (await hasArtistStatsProjection()) {
        const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
        const thumbnailSelect = hasThumbnailColumn
          ? `
              COALESCE(
                CASE
                  WHEN s.thumbnail_video_id IS NOT NULL
                    AND EXISTS (
                      SELECT 1
                      FROM videos v
                      INNER JOIN site_videos sv ON sv.video_id = v.id
                      WHERE v.videoId = s.thumbnail_video_id
                        AND sv.status = 'available'
                    )
                  THEN s.thumbnail_video_id
                  ELSE NULL
                END,
                (
                  SELECT SUBSTRING_INDEX(GROUP_CONCAT(v2.videoId ORDER BY v2.id ASC), ',', 1)
                  FROM videos v2
                  INNER JOIN site_videos sv2 ON sv2.video_id = v2.id
                  WHERE LOWER(TRIM(v2.parsedArtist)) = s.normalized_artist
                    AND v2.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
                    AND sv2.status = 'available'
                )
              ) AS thumbnailVideoId
            `
          : "NULL AS thumbnailVideoId";
        const rows = await prisma.$queryRawUnsafe<Array<{
          displayName: string;
          slug: string;
          country: string | null;
          genre: string | null;
          thumbnailVideoId: string | null;
        }>>(
          `
            SELECT s.display_name AS displayName, s.slug, s.country, s.genre, ${thumbnailSelect}
            FROM artist_stats s
            WHERE s.video_count > 0
            ORDER BY s.display_name ASC
            LIMIT 24
          `,
        );

        if (rows.length > 0) {
          return rows.map(mapArtistProjectionRow);
        }
      }

      const artists = await findArtistsInDatabase({
        limit: 24,
        orderByName: true,
      });

      return artists.length > 0 ? artists.map(mapArtist) : seedArtists;
    } catch {
      return seedArtists;
    }
  };

  const pending = resolveArtists();
  artistsListInFlight = pending;

  try {
    const rows = await pending;
    artistsListCache = {
      expiresAt: Date.now() + ARTISTS_LIST_CACHE_TTL_MS,
      rows,
    };
    return rows;
  } finally {
    if (artistsListInFlight === pending) {
      artistsListInFlight = undefined;
    }
  }
}

export async function getArtistsByLetter(letter: string, limit = 120, offset = 0): Promise<Array<ArtistRecord & { videoCount: number }>> {
  const normalizedLetter = letter.trim().toUpperCase();
  const safeLimit = Math.max(1, Math.min(limit, 300));
  const safeOffset = Math.max(0, Math.floor(offset));
  const projectionPageCacheKey = `${normalizedLetter}:${safeOffset}:${safeLimit}`;
  const countFromSeed = (artistName: string) => {
    const normalizedName = artistName.trim().toLowerCase();
    return seedVideos.filter((video) => {
      return (
        video.channelTitle.toLowerCase().includes(normalizedName) ||
        video.title.toLowerCase().includes(normalizedName)
      );
    }).length;
  };

  if (!/^[A-Z]$/.test(normalizedLetter)) {
    return [];
  }

  if (!hasDatabaseUrl()) {
    return seedArtists
      .filter((artist) => artist.name.trim().toUpperCase().startsWith(normalizedLetter))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((artist) => ({
        ...artist,
        videoCount: countFromSeed(artist.name),
      }))
      .filter((artist) => artist.videoCount > 0);
  }

  try {
    if (await hasArtistStatsProjection()) {
      const now = Date.now();
      const cachedPage = artistLetterPageCache.get(projectionPageCacheKey);
      if (cachedPage && cachedPage.expiresAt > now) {
        return cachedPage.rows;
      }

      const inFlight = artistLetterPageInFlight.get(projectionPageCacheKey);
      if (inFlight) {
        return await inFlight;
      }

      const hasThumbnailColumn = await hasArtistStatsThumbnailColumn();
      const queryPromise = (async () => {
        const projectedRows = await prisma.$queryRawUnsafe<Array<{
          displayName: string;
          slug: string;
          country: string | null;
          genre: string | null;
          videoCount: number | null;
          thumbnailVideoId: string | null;
        }>>(
          `
            SELECT
              s.display_name AS displayName,
              s.slug,
              s.country,
              s.genre,
              s.video_count AS videoCount,
              ${hasThumbnailColumn ? "s.thumbnail_video_id" : "NULL"} AS thumbnailVideoId
            FROM artist_stats s
            WHERE s.first_letter = ?
              AND s.video_count > 0
            ORDER BY s.display_name ASC
            LIMIT ${safeLimit}
            OFFSET ${safeOffset}
          `,
          normalizedLetter,
        );

        if (projectedRows.length > 0 || safeOffset > 0) {
          const mapped = projectedRows.map((row) => ({
            ...mapArtistProjectionRow(row),
            videoCount: Number(row.videoCount ?? 0),
          }));

          artistLetterPageCache.set(projectionPageCacheKey, {
            expiresAt: Date.now() + ARTIST_LETTER_PAGE_CACHE_TTL_MS,
            rows: mapped,
          });

          return mapped;
        }

        return [];
      })();

      artistLetterPageInFlight.set(projectionPageCacheKey, queryPromise);

      const projected = await queryPromise.finally(() => {
        artistLetterPageInFlight.delete(projectionPageCacheKey);
      });

      if (projected.length > 0 || safeOffset > 0) {
        return projected;
      }
    }

    const columns = await getArtistColumnMap();
    const statsSource = await getArtistVideoStatsSource();
    const letterCacheKey = `${statsSource}:${normalizedLetter}`;

    if (statsSource === "parsedArtist") {
      const cachedRows = getArtistLetterCache(letterCacheKey);
      if (cachedRows) {
        return cachedRows.slice(safeOffset, safeOffset + safeLimit);
      }

      const inFlightRows = artistLetterInFlight.get(letterCacheKey);
      if (inFlightRows) {
        const sharedRows = await inFlightRows;
        return sharedRows.slice(safeOffset, safeOffset + safeLimit);
      }
    }

    const nameCol = escapeSqlIdentifier(columns.name);
    const artistNameNormExpr = getArtistNameNormalizationExpr("a", columns);
    const normalizedLetterKey = normalizedLetter.toLowerCase();
    const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
    const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
    const genreExpr =
      columns.genreColumns.length > 0
        ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
        : "NULL";

    if (statsSource === "parsedArtist") {
      const buildRowsPromise = (async () => {
        const artists = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
          `
            SELECT
              a.${nameCol} AS name,
              ${countrySelect},
              ${genreExpr} AS genre1
            FROM artists a
            WHERE a.${nameCol} IS NOT NULL
              AND TRIM(a.${nameCol}) <> ''
              AND LEFT(${artistNameNormExpr}, 1) = ?
            ORDER BY a.${nameCol} ASC
          `,
          normalizedLetterKey,
        );

        const parsedArtistCounts = await prisma.$queryRawUnsafe<Array<{ artistKey: string | null; videoCount: number | null; thumbnailVideoId: string | null }>>(
          `
            SELECT
              ${videoArtistNormExpr} AS artistKey,
              COUNT(DISTINCT v.videoId) AS videoCount,
              SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
            FROM videos v
            WHERE ${videoArtistNormExpr} <> ''
              AND v.videoId IS NOT NULL
              AND CHAR_LENGTH(v.videoId) = 11
              AND EXISTS (
                SELECT 1
                FROM site_videos sv
                WHERE sv.video_id = v.id
                  AND sv.status = 'available'
              )
              AND ${videoArtistNormExpr} LIKE ?
            GROUP BY ${videoArtistNormExpr}
          `,
          `${normalizedLetterKey}%`,
        );

        const countByArtist = new Map<string, number>();
        const thumbnailByArtist = new Map<string, string>();
        for (const row of parsedArtistCounts) {
          const key = row.artistKey?.trim();
          if (!key) {
            continue;
          }

          const nextCount = Number(row.videoCount ?? 0);
          countByArtist.set(key, (countByArtist.get(key) ?? 0) + nextCount);
          if (row.thumbnailVideoId) {
            thumbnailByArtist.set(key, row.thumbnailVideoId);
          }
        }

        const rows = artists
          .map((row) => {
            const key = normalizeArtistKey(row.name);
            return {
              ...mapArtist(row),
              videoCount: countByArtist.get(key) ?? 0,
              thumbnailVideoId: thumbnailByArtist.get(key),
            };
          })
          .filter((artist) => artist.videoCount > 0);

        setArtistLetterCache(letterCacheKey, rows);
        scheduleArtistStatsLetterBackfill(normalizedLetter, rows);
        return rows;
      })();

      artistLetterInFlight.set(letterCacheKey, buildRowsPromise);

      try {
        const rows = await buildRowsPromise;
        return rows.slice(safeOffset, safeOffset + safeLimit);
      } finally {
        if (artistLetterInFlight.get(letterCacheKey) === buildRowsPromise) {
          artistLetterInFlight.delete(letterCacheKey);
        }
      }
    }

    let videoCountSubquery = `
      SELECT
        ${videoArtistNormExpr} AS artistKey,
        COUNT(DISTINCT v.videoId) AS videoCount,
        SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
      FROM videos v
      WHERE ${videoArtistNormExpr} <> ''
        AND v.videoId IS NOT NULL
        AND CHAR_LENGTH(v.videoId) = 11
        AND LEFT(${videoArtistNormExpr}, 1) = ?
      GROUP BY ${videoArtistNormExpr}
    `;

    if (statsSource === "videosbyartist") {
      const artistVideoColumns = await getArtistVideoColumnMap();
      const vaArtistCol = escapeSqlIdentifier(artistVideoColumns.artistName);
      const vaArtistNormExpr = artistVideoColumns.normalizedArtistName
        ? `COALESCE(va.${escapeSqlIdentifier(artistVideoColumns.normalizedArtistName)}, '')`
        : `LOWER(TRIM(COALESCE(va.${vaArtistCol}, '')))`;
      const vaVideoRefCol = escapeSqlIdentifier(artistVideoColumns.videoRef);
      const joinVideoExpr = artistVideoColumns.joinsOnVideoPrimaryId ? "v.id" : "v.videoId";

      videoCountSubquery = `
        SELECT
          ${vaArtistNormExpr} AS artistKey,
          COUNT(DISTINCT v.videoId) AS videoCount,
          SUBSTRING_INDEX(GROUP_CONCAT(v.videoId ORDER BY v.id ASC), ',', 1) AS thumbnailVideoId
        FROM videosbyartist va
        INNER JOIN videos v ON ${joinVideoExpr} = va.${vaVideoRefCol}
        WHERE ${vaArtistNormExpr} <> ''
          AND LEFT(${vaArtistNormExpr}, 1) = ?
          AND v.videoId IS NOT NULL
          AND CHAR_LENGTH(v.videoId) = 11
        GROUP BY ${vaArtistNormExpr}
      `;
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null; videoCount: number | null; thumbnailVideoId: string | null }>>(
      `
        SELECT
          a.${nameCol} AS name,
          ${countrySelect},
          ${genreExpr} AS genre1,
          vc.videoCount AS videoCount,
          vc.thumbnailVideoId AS thumbnailVideoId
        FROM artists a
        INNER JOIN (${videoCountSubquery}) vc ON vc.artistKey = ${artistNameNormExpr}
        WHERE vc.videoCount > 0
          AND a.${nameCol} IS NOT NULL
          AND TRIM(a.${nameCol}) <> ''
          AND LEFT(${artistNameNormExpr}, 1) = ?
        ORDER BY a.${nameCol} ASC
        LIMIT ${safeLimit}
        OFFSET ${safeOffset}
      `,
      normalizedLetterKey,
      normalizedLetterKey,
    );

    const mappedRows = rows.map((row) => ({
      ...mapArtist(row),
      videoCount: Number(row.videoCount ?? 0),
      thumbnailVideoId: row.thumbnailVideoId ?? undefined,
    }));
    scheduleArtistStatsLetterBackfill(normalizedLetter, mappedRows);
    return mappedRows;
  } catch {
    return seedArtists
      .filter((artist) => artist.name.trim().toUpperCase().startsWith(normalizedLetter))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((artist) => ({
        ...artist,
        videoCount: countFromSeed(artist.name),
      }))
      .filter((artist) => artist.videoCount > 0);
  }
}

export async function getArtistBySlug(slug: string) {
  if (!hasDatabaseUrl()) {
    return getSeedArtistBySlug(slug);
  }

  try {
    if (await hasArtistStatsProjection()) {
      const rows = await prisma.$queryRawUnsafe<Array<{
        displayName: string;
        slug: string;
        country: string | null;
        genre: string | null;
      }>>(
        `
          SELECT display_name AS displayName, slug, country, genre
          FROM artist_stats
          WHERE slug = ?
          LIMIT 1
        `,
        slug,
      );

      if (rows.length > 0) {
        return mapArtistProjectionRow(rows[0]);
      }
    }

    const now = Date.now();
    if (artistSlugLookupCache && artistSlugLookupCache.expiresAt > now) {
      return artistSlugLookupCache.rowsBySlug.get(slug) ?? getSeedArtistBySlug(slug);
    }

    const singleCached = artistSingleSlugCache.get(slug);
    if (singleCached && singleCached.expiresAt > now) {
      return singleCached.artist;
    }

    const slugTerms = slug
      .trim()
      .toLowerCase()
      .split("-")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .slice(0, 8);

    if (slugTerms.length > 0) {
      const columns = await getArtistColumnMap();
      const nameCol = escapeSqlIdentifier(columns.name);
      const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
      const genreExpr =
        columns.genreColumns.length > 0
          ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
          : "NULL";

      const termPredicates = slugTerms.map(() => `LOWER(a.${nameCol}) LIKE ?`).join(" AND ");
      const termParams = slugTerms.map((term) => `%${term}%`);

      const narrowed = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
        `
          SELECT
            a.${nameCol} AS name,
            ${countrySelect},
            ${genreExpr} AS genre1
          FROM artists a
          WHERE a.${nameCol} IS NOT NULL
            AND TRIM(a.${nameCol}) <> ''
            AND ${termPredicates}
          ORDER BY a.${nameCol} ASC
          LIMIT 400
        `,
        ...termParams,
      );

      const fastMatch = narrowed.find((artist) => slugify(artist.name) === slug);
      if (fastMatch) {
        const mapped = mapArtist(fastMatch);
        artistSingleSlugCache.set(slug, {
          expiresAt: Date.now() + ARTIST_SINGLE_SLUG_CACHE_TTL_MS,
          artist: mapped,
        });
        return mapped;
      }
    }

    if (!artistSlugLookupInFlight) {
      artistSlugLookupInFlight = (async () => {
        const columns = await getArtistColumnMap();
        const nameCol = escapeSqlIdentifier(columns.name);
        const countrySelect = columns.country ? `a.${escapeSqlIdentifier(columns.country)} AS country` : "NULL AS country";
        const genreExpr =
          columns.genreColumns.length > 0
            ? `COALESCE(${columns.genreColumns.map((column) => `a.${escapeSqlIdentifier(column)}`).join(", ")})`
            : "NULL";

        const artists = await prisma.$queryRawUnsafe<Array<{ name: string; country: string | null; genre1: string | null }>>(
          `
            SELECT
              a.${nameCol} AS name,
              ${countrySelect},
              ${genreExpr} AS genre1
            FROM artists a
            WHERE a.${nameCol} IS NOT NULL
              AND TRIM(a.${nameCol}) <> ''
            ORDER BY a.${nameCol} ASC
          `,
        );

        const rowsBySlug = new Map<string, ArtistRecord>();
        for (const row of artists) {
          const mapped = mapArtist(row);
          // Preserve existing behavior by keeping the first row encountered
          // for any slug collision in name-ordered results.
          if (!rowsBySlug.has(mapped.slug)) {
            rowsBySlug.set(mapped.slug, mapped);
          }
        }

        artistSlugLookupCache = {
          expiresAt: Date.now() + ARTIST_SLUG_LOOKUP_CACHE_TTL_MS,
          rowsBySlug,
        };

        return rowsBySlug;
      })().finally(() => {
        artistSlugLookupInFlight = undefined;
      });
    }

    const rowsBySlug = await artistSlugLookupInFlight;
    return rowsBySlug.get(slug) ?? getSeedArtistBySlug(slug);
  } catch {
    return getSeedArtistBySlug(slug);
  }
}

export async function getVideosByArtist(artistName: string, limit = 500) {
  const exactArtist = artistName.trim();
  const normalizedArtist = exactArtist.toLowerCase();
  const safeLimit = Math.max(1, Math.min(limit, 500));

  if (!normalizedArtist) {
    return [] as VideoRecord[];
  }

  const cacheKey = `${normalizedArtist}:${safeLimit}`;
  const cached = artistVideosCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.videos;
  }

  if (!hasDatabaseUrl()) {
    const fallback = seedVideos
      .filter((video) =>
        video.channelTitle.toLowerCase().includes(normalizedArtist) ||
        video.title.toLowerCase().includes(normalizedArtist),
      )
      .slice(0, safeLimit);
    artistVideosCache.set(cacheKey, {
      expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS,
      videos: fallback,
    });
    return fallback;
  }

  try {
    const videoArtistNormColumn = await getVideoArtistNormalizationColumn();
    const videoArtistNormExpr = getVideoArtistNormalizationExpr("v", videoArtistNormColumn);
    const conflictingArtistNormExpr = getVideoArtistNormalizationExpr("v_conflict", videoArtistNormColumn);

    const query = `
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE ${videoArtistNormExpr} = ?
        AND v.videoId IS NOT NULL
        AND CHAR_LENGTH(v.videoId) = 11
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM videos v_conflict
          WHERE v_conflict.videoId = v.videoId
            AND v_conflict.videoId IS NOT NULL
            AND CHAR_LENGTH(v_conflict.videoId) = 11
            AND ${conflictingArtistNormExpr} <> ''
            AND ${conflictingArtistNormExpr} <> ?
        )
      ORDER BY COALESCE(v.viewCount, 0) DESC, v.id ASC
      LIMIT ${safeLimit}
    `;

    let rows = await prisma.$queryRawUnsafe<Array<{
      videoId: string;
      title: string;
      channelTitle: string | null;
      favourited: number;
      description: string | null;
    }>>(query, normalizedArtist, normalizedArtist);

    const mapped = rows
      .map(mapVideo)
      .filter((video, index, allVideos) => allVideos.findIndex((candidate) => candidate.id === video.id) === index);
    artistVideosCache.set(cacheKey, {
      expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS,
      videos: mapped,
    });

    // Reconcile projection in the background to keep page response fast.
    void (async () => {
      try {
        if (await hasArtistStatsProjection()) {
          const projectionRows = await prisma.$queryRawUnsafe<Array<{ videoCount: number | null }>>(
            `
              SELECT video_count AS videoCount
              FROM artist_stats
              WHERE normalized_artist = ?
              LIMIT 1
            `,
            normalizedArtist,
          );

          const projectedCount = Number(projectionRows[0]?.videoCount ?? 0);
          if (projectedCount !== mapped.length) {
            await refreshArtistProjectionForName(artistName).catch(() => undefined);
          }
          return;
        }

        if (mapped.length === 0) {
          await refreshArtistProjectionForName(artistName).catch(() => undefined);
        }
      } catch {
        // best-effort reconciliation only
      }
    })();

    return mapped;
  } catch {
    const fallback = seedVideos
      .filter((video) =>
        video.channelTitle.toLowerCase().includes(normalizedArtist) ||
        video.title.toLowerCase().includes(normalizedArtist),
      )
      .slice(0, safeLimit);
    artistVideosCache.set(cacheKey, {
      expiresAt: Date.now() + ARTIST_VIDEOS_CACHE_TTL_MS,
      videos: fallback,
    });
    return fallback;
  }
}

export async function searchCatalog(query: string) {
  if (!hasDatabaseUrl()) {
    return searchSeedCatalog(query);
  }

  const normalized = query.trim();

  if (!normalized) {
    return {
      videos: await getTopVideos(),
      artists: await getArtists(),
      genres: seedGenres.slice(0, 6),
    };
  }

  try {
    // MySQL fulltext ignores words shorter than ft_min_word_len (default 4, InnoDB default 3).
    // Filtering here avoids the common failure where all tokens are stop-words/too-short
    // which would cause +word* syntax to return zero results.
    const FT_MIN_WORD_LEN = 3;
    // Strip MySQL FTS boolean-mode operators before building the query to avoid syntax errors
    const ftWords = normalized
      .split(/\s+/)
      .map((w) => w.replace(/[+\-><()~*"@]/g, ""))
      .filter((w) => w.length >= FT_MIN_WORD_LEN);

    // Use word* (OR mode, no + prefix) so partial matches are returned ranked by relevance.
    // Requiring all tokens with + breaks multi-word artist names that include stop words.
    const booleanQuery = ftWords.map((w) => `${w}*`).join(" ");

    const [ftVideos, artists] = await Promise.all([
      ftWords.length > 0
        ? prisma.$queryRaw<Array<{ videoId: string; title: string; channelTitle: string | null; favourited: number; description: string | null }>>`
            SELECT videoId, title, NULL AS channelTitle, favourited, description,
                   MATCH(title, parsedArtist, parsedTrack) AGAINST(${booleanQuery} IN BOOLEAN MODE) AS score
            FROM videos
            WHERE MATCH(title, parsedArtist, parsedTrack) AGAINST(${booleanQuery} IN BOOLEAN MODE)
            ORDER BY score DESC
            LIMIT 50
          `
        : Promise.resolve([]),
      findArtistsInDatabase({
        limit: 12,
        search: normalized,
      }),
    ]);

    // LIKE fallback: when fulltext returns no results (all short words, or no indexed terms)
    // try a phrase-level LIKE across all searchable text columns.
    let videos = ftVideos;
    if (videos.length === 0) {
      const likePattern = `%${normalized}%`;
      videos = await prisma.$queryRaw<Array<{ videoId: string; title: string; channelTitle: string | null; favourited: number; description: string | null }>>`
        SELECT videoId, title, NULL AS channelTitle, favourited, description, 1 AS score
        FROM videos
        WHERE title LIKE ${likePattern}
           OR parsedArtist LIKE ${likePattern}
           OR parsedTrack LIKE ${likePattern}
        ORDER BY favourited DESC
        LIMIT 50
      `;
    }

    const rankingSignals = await getSearchRankingSignals({
      query: normalized,
      candidateVideoIds: videos.map((video) => video.videoId),
    });

    const rankedVideos = videos
      .filter((video) => !rankingSignals.suppressedVideoIds.has(video.videoId))
      .map((video, index) => ({
        video,
        index,
        penalty: rankingSignals.penaltyByVideoId.get(video.videoId) ?? 0,
      }))
      .sort((left, right) => {
        if (left.penalty !== right.penalty) {
          return left.penalty - right.penalty;
        }

        return left.index - right.index;
      })
      .map((entry) => entry.video);

    videos = rankedVideos;

    return {
      videos: videos.length > 0 ? videos.map(mapVideo) : searchSeedCatalog(query).videos,
      artists: artists.length > 0 ? artists.map(mapArtist) : searchSeedCatalog(query).artists,
      genres: seedGenres.filter((genre) => genre.toLowerCase().includes(normalized.toLowerCase())),
    };
  } catch (err) {
    console.error("[searchCatalog] query failed, falling back to seed:", err);
    return searchSeedCatalog(query);
  }
}

export type SearchSuggestion = {
  type: "artist" | "track" | "genre";
  label: string;
  /** Relative URL destination used directly by the search UI. */
  url: string;
};

const suggestCacheMap = new Map<string, { expiresAt: number; results: SearchSuggestion[] }>();
const suggestInFlightMap = new Map<string, Promise<SearchSuggestion[]>>();
const SUGGEST_CACHE_TTL_MS = 10_000;

export async function suggestCatalog(query: string): Promise<SearchSuggestion[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const normalizedLower = normalized.toLowerCase();

  const now = Date.now();
  const cached = suggestCacheMap.get(normalizedLower);
  if (cached && cached.expiresAt > now) return cached.results;

  const inFlight = suggestInFlightMap.get(normalizedLower);
  if (inFlight) return inFlight;

  const resolveSuggestions = (async () => {
    const prefixPattern = `${normalized}%`;

    const [artistRows, trackRows] = await Promise.all([
      hasDatabaseUrl()
        ? findArtistsInDatabase({
            limit: 4,
            search: normalized,
            orderByName: true,
            prefixOnly: true,
            nameOnly: true,
          })
        : seedArtists
            .filter((a) => a.name.toLowerCase().startsWith(normalized.toLowerCase()))
            .slice(0, 4),

      hasDatabaseUrl()
        ? prisma.$queryRaw<Array<{ videoId: string; title: string }>>`
            SELECT videoId, title
            FROM videos
            WHERE title LIKE ${prefixPattern}
            ORDER BY favourited DESC
            LIMIT 4
          `
        : seedVideos
            .filter((v) => v.title.toLowerCase().startsWith(normalized.toLowerCase()))
            .map((v) => ({ videoId: v.id, title: v.title }))
            .slice(0, 4),
    ]);

    const genreSuggestions: SearchSuggestion[] = seedGenres
      .filter((g) => g.toLowerCase().startsWith(normalized.toLowerCase()))
      .slice(0, 3)
      .map((g) => ({ type: "genre", label: g, url: `/categories/${getGenreSlug(g)}` }));

    const artistSuggestions: SearchSuggestion[] = artistRows.map((r) => ({
      type: "artist",
      label: r.name,
      url: `/artist/${slugify(r.name)}`,
    }));

    const trackSuggestions: SearchSuggestion[] = trackRows.map((r) => ({
      type: "track",
      label: r.title,
      url: `/?v=${encodeURIComponent(r.videoId)}&resume=1`,
    }));

    const strictPrefixSuggestions = [...artistSuggestions, ...genreSuggestions, ...trackSuggestions].filter((suggestion) =>
      suggestion.label.trim().toLowerCase().startsWith(normalizedLower),
    );

    // Interleave: artists first, then genres, then tracks, deduped by label
    const seen = new Set<string>();
    const results: SearchSuggestion[] = [];
    for (const s of strictPrefixSuggestions) {
      const key = s.label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(s);
      }
      if (results.length >= 10) break;
    }

    suggestCacheMap.set(normalizedLower, { expiresAt: Date.now() + SUGGEST_CACHE_TTL_MS, results });
    return results;
  })();

  suggestInFlightMap.set(normalizedLower, resolveSuggestions);
  try {
    return await resolveSuggestions;
  } finally {
    if (suggestInFlightMap.get(normalizedLower) === resolveSuggestions) {
      suggestInFlightMap.delete(normalizedLower);
    }
  }
}

export async function getGenres() {
  if (!hasDatabaseUrl()) {
    return seedGenres;
  }

  const now = Date.now();
  if (genreListCache && genreListCache.expiresAt > now) {
    return genreListCache.genres;
  }

  try {
    // Read from genre_cards which is the pre-built canonical store.
    // Falls back to the genres table if genre_cards is empty (first run before batch script).
    const rows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT genre FROM genre_cards ORDER BY genre ASC LIMIT 1000
    `;

    if (rows.length > 0) {
      const genres = rows.map((r) => r.genre);
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
      return genres;
    }

    // genre_cards not yet populated — fall back to genres table
    const fallbackRows = await prisma.$queryRaw<Array<{ genre: string }>>`
      SELECT name AS genre FROM genres WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC LIMIT 500
    `;
    const genres = fallbackRows.map((r) => r.genre);
    genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres };
    return genres;
  } catch {
    return genreListCache?.genres ?? [];
  }
}

export async function getGenreCards() {
  if (!hasDatabaseUrl()) {
    return seedGenres.map((genre) => ({ genre, previewVideoId: null }));
  }

  const now = Date.now();
  if (
    genreCardsCache
    && genreCardsCache.expiresAt > now
    && genreCardsCache.cards.length > 0
    && genreCardsCache.cards.some((card) => !!card.previewVideoId)
  ) {
    return genreCardsCache.cards;
  }

  if (genreCardsInFlight) {
    // Await the in-flight request so concurrent callers don't receive an empty list
    // while the first request is still resolving.
    return genreCardsInFlight;
  }

  genreCardsInFlight = (async () => {
    try {
      const rows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
        SELECT gc.genre, MAX(gc.thumbnail_video_id) AS thumbnailVideoId
        FROM genre_cards gc
        WHERE gc.thumbnail_video_id IS NOT NULL
          AND gc.thumbnail_video_id <> ''
          AND gc.genre IS NOT NULL
          AND TRIM(gc.genre) <> ''
          AND EXISTS (
            SELECT 1 FROM videos v
            INNER JOIN site_videos sv ON sv.video_id = v.id
            WHERE v.genre = gc.genre
              AND sv.status = 'available'
          )
        GROUP BY gc.genre
        ORDER BY genre ASC
        LIMIT 1000
      `;

      let cards: GenreCard[] = rows.map((row) => {
        const thumbnailVideoId = row.thumbnailVideoId ?? row.thumbnail_video_id ?? null;
        return {
          genre: row.genre,
          previewVideoId: thumbnailVideoId,
        };
      });

      // Fallback: if the strict availability query is empty, read directly from genre_cards
      // so categories can still render their stored thumbnail previews.
      if (cards.length === 0) {
        const fallbackRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
          SELECT gc.genre, MAX(gc.thumbnail_video_id) AS thumbnailVideoId
          FROM genre_cards gc
          WHERE gc.genre IS NOT NULL
            AND TRIM(gc.genre) <> ''
          GROUP BY gc.genre
          ORDER BY gc.genre ASC
          LIMIT 1000
        `;
        if (fallbackRows.length > 0) {
          cards = fallbackRows.map((r) => ({
            genre: r.genre,
            previewVideoId: r.thumbnailVideoId ?? r.thumbnail_video_id ?? null,
          }));
        } else {
          // genre_cards table empty — fall back to genres table
          const genreRows = await prisma.$queryRaw<Array<{ genre: string }>>`
            SELECT name AS genre FROM genres WHERE name IS NOT NULL AND TRIM(name) <> '' ORDER BY name ASC LIMIT 1000
          `;
          cards = genreRows.map((r) => ({ genre: r.genre, previewVideoId: null }));
        }
      }

      if (cards.length === 0) {
        cards = (await getGenres()).map((genre) => ({ genre, previewVideoId: null }));
      }

      if (cards.some((card) => !card.previewVideoId)) {
        const thumbnailRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
          SELECT
            v.genre AS genre,
            SUBSTRING_INDEX(
              GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC),
              ',',
              1
            ) AS thumbnailVideoId
          FROM videos v
          INNER JOIN site_videos sv
            ON sv.video_id = v.id
           AND sv.status = 'available'
          WHERE v.genre IS NOT NULL
            AND TRIM(v.genre) <> ''
            AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
          GROUP BY v.genre
          ORDER BY v.genre ASC
          LIMIT 1000
        `;

        if (thumbnailRows.length > 0) {
          const thumbnailByGenre = new Map<string, string>();
          for (const row of thumbnailRows) {
            const genreKey = row.genre.trim().toLowerCase();
            const videoId = (row.thumbnailVideoId ?? row.thumbnail_video_id ?? "").trim();
            if (!genreKey || !videoId) continue;
            thumbnailByGenre.set(genreKey, videoId);
          }

          cards = cards.map((card) => {
            if (card.previewVideoId) return card;
            const derived = thumbnailByGenre.get(card.genre.trim().toLowerCase()) ?? null;
            return derived ? { ...card, previewVideoId: derived } : card;
          });
        }

        if (cards.some((card) => !card.previewVideoId)) {
          const looseThumbnailRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
            SELECT
              v.genre AS genre,
              SUBSTRING_INDEX(
                GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC),
                ',',
                1
              ) AS thumbnailVideoId
            FROM videos v
            WHERE v.genre IS NOT NULL
              AND TRIM(v.genre) <> ''
              AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            GROUP BY v.genre
            ORDER BY v.genre ASC
            LIMIT 1000
          `;

          if (looseThumbnailRows.length > 0) {
            const looseThumbnailByGenre = new Map<string, string>();
            for (const row of looseThumbnailRows) {
              const genreKey = row.genre.trim().toLowerCase();
              const videoId = (row.thumbnailVideoId ?? row.thumbnail_video_id ?? "").trim();
              if (!genreKey || !videoId) continue;
              looseThumbnailByGenre.set(genreKey, videoId);
            }

            cards = cards.map((card) => {
              if (card.previewVideoId) return card;
              const derived = looseThumbnailByGenre.get(card.genre.trim().toLowerCase()) ?? null;
              return derived ? { ...card, previewVideoId: derived } : card;
            });
          }
        }

        if (cards.some((card) => !card.previewVideoId)) {
          const fuzzyRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
            SELECT
              gc.genre AS genre,
              SUBSTRING_INDEX(
                GROUP_CONCAT(v.videoId ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.id ASC),
                ',',
                1
              ) AS thumbnailVideoId
            FROM genre_cards gc
            LEFT JOIN videos v
              ON v.genre IS NOT NULL
             AND TRIM(v.genre) <> ''
             AND LOWER(v.genre) LIKE CONCAT('%', LOWER(gc.genre), '%')
             AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            WHERE gc.genre IS NOT NULL
              AND TRIM(gc.genre) <> ''
            GROUP BY gc.genre
            ORDER BY gc.genre ASC
            LIMIT 1000
          `;

          if (fuzzyRows.length > 0) {
            const fuzzyByGenre = new Map<string, string>();
            for (const row of fuzzyRows) {
              const genreKey = row.genre.trim().toLowerCase();
              const videoId = (row.thumbnailVideoId ?? row.thumbnail_video_id ?? "").trim();
              if (!genreKey || !videoId) continue;
              fuzzyByGenre.set(genreKey, videoId);
            }

            cards = cards.map((card) => {
              if (card.previewVideoId) return card;
              const derived = fuzzyByGenre.get(card.genre.trim().toLowerCase()) ?? null;
              return derived ? { ...card, previewVideoId: derived } : card;
            });
          }
        }
      }

      genreCardsCache = { expiresAt: now + GENRE_CARDS_CACHE_TTL_MS, cards };
      // Keep genre list in sync
      genreListCache = { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, genres: cards.map((c) => c.genre) };
      return cards;
    } catch {
      try {
        const rawFallbackRows = await prisma.$queryRaw<Array<{ genre: string; thumbnailVideoId?: string | null; thumbnail_video_id?: string | null }>>`
          SELECT genre, thumbnail_video_id AS thumbnailVideoId
          FROM genre_cards
          WHERE genre IS NOT NULL
            AND TRIM(genre) <> ''
          ORDER BY genre ASC
          LIMIT 1000
        `;
        if (rawFallbackRows.length > 0) {
          const fallbackCards = rawFallbackRows.map((row) => ({
            genre: row.genre,
            previewVideoId: row.thumbnailVideoId ?? row.thumbnail_video_id ?? null,
          }));
          genreCardsCache = { expiresAt: now + 30_000, cards: fallbackCards };
          return fallbackCards;
        }
      } catch {
        // Fall through to genre-only fallback when genre_cards cannot be read.
      }

      const fallbackCards = (await getGenres()).map((genre) => ({ genre, previewVideoId: null }));
      genreCardsCache = { expiresAt: now + 30_000, cards: fallbackCards };
      return fallbackCards;
    }
  })().finally(() => {
    genreCardsInFlight = undefined;
  });

  // Await on first load so the page renders with real data
  if (!genreCardsCache) {
    return genreCardsInFlight;
  }

  return genreCardsCache.cards;
}

export async function getGenreBySlug(slug: string) {
  const genres = await getGenres();
  return genres.find((genre) => getGenreSlug(genre) === slug);
}

function getArtistsByGenreFallback(genre: string) {
  return seedArtists.filter((artist) => {
    return artist.genre.toLowerCase().includes(genre.toLowerCase());
  });
}

export async function getArtistsByGenre(genre: string) {
  const cacheKey = genre.trim().toLowerCase();
  const cached = genreArtistsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.artists;
  }

  if (!hasDatabaseUrl()) {
    const fallback = getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: fallback });
    return fallback;
  }

  try {
    const artists = await prisma.$queryRaw<Array<{ name: string; country: string | null; genre1: string | null }>>`
      SELECT
        a.name,
        a.origin AS country,
        COALESCE(a.genre1, a.genre2, a.genre3, a.genre4, a.genre5, a.genre6) AS genre1
      FROM artists a
      WHERE (
        a.genre1 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre2 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre3 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre4 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre5 LIKE CONCAT('%', ${genre}, '%')
        OR a.genre6 LIKE CONCAT('%', ${genre}, '%')
      )
    `;

    const mappedArtists = artists.length > 0
      ? artists.map(mapArtist).sort((a, b) => a.name.localeCompare(b.name))
      : getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, {
      expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS,
      artists: mappedArtists,
    });
    return mappedArtists;
  } catch {
    const fallback = getArtistsByGenreFallback(genre);
    genreArtistsCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, artists: fallback });
    return fallback;
  }
}

export async function getVideosByGenre(
  genre: string,
  options?: {
    artists?: Awaited<ReturnType<typeof getArtistsByGenre>>;
    offset?: number;
    limit?: number;
  }
) {
  const cacheKey = genre.trim().toLowerCase();
  const requestedOffset = Math.max(0, Number.isFinite(options?.offset) ? Number(options?.offset) : 0);
  const requestedLimit = Math.max(1, Math.min(120, Number.isFinite(options?.limit) ? Number(options?.limit) : 24));
  const minRequiredRows = requestedOffset + requestedLimit;
  const useDefaultCacheWindow = !options?.artists && requestedOffset === 0 && requestedLimit === 24;
  const fetchQueryLimit = Math.max(requestedLimit + requestedOffset + 24, requestedLimit + 24);
  const now = Date.now();
  if (useDefaultCacheWindow) {
    const cached = genreVideosCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.videos.length > 0) {
      return cached.videos;
    }

    if (cached && cached.videos.length === 0) {
      genreVideosCache.delete(cacheKey);
    }
  }

  const storeGenreVideosInCache = (videos: VideoRecord[]) => {
    if (useDefaultCacheWindow && videos.length > 0) {
      genreVideosCache.set(cacheKey, { expiresAt: now + GENRE_RESULTS_CACHE_TTL_MS, videos });
    }
  };

  const buildUniqueGenreVideos = (rows: RankedVideoRow[]) => {
    return dedupeRankedRows(rows)
      .slice(requestedOffset, requestedOffset + requestedLimit)
      .map(mapVideo);
  };

  let bestRows: RankedVideoRow[] = [];

  const considerRows = (rows: RankedVideoRow[]) => {
    if (!rows || rows.length === 0) {
      return;
    }

    bestRows = dedupeRankedRows([...bestRows, ...rows]);
  };

  const canResolveWindow = () => bestRows.length >= minRequiredRows;

  const resolveFromBestRows = () => {
    if (bestRows.length === 0) {
      return [] as VideoRecord[];
    }

    return buildUniqueGenreVideos(bestRows);
  };

  const getGenreFallback = async () => {
    if (!hasDatabaseUrl()) {
      return seedVideos.slice(requestedOffset, requestedOffset + requestedLimit);
    }
    return [];
  };

  const getGenreKeywordVideos = async () => {
    const rows = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (${genre} IN NATURAL LANGUAGE MODE)
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
      LIMIT ${fetchQueryLimit}
    `;

    return rows;
  };

  if (!hasDatabaseUrl()) {
    return seedVideos;
  }

  try {
    return await withSoftTimeout(`getVideosByGenre:${cacheKey}`, CATEGORY_QUERY_TIMEOUT_MS, async () => {
      const keywordVideos = await getGenreKeywordVideos();
      considerRows(keywordVideos);

      const artistColumns = await getArtistColumnMap();
      if (artistColumns.genreColumns.length > 0) {
        const artistNameColumn = escapeSqlIdentifier(artistColumns.name);
        const genrePredicates = artistColumns.genreColumns
          .map((column) => `a.${escapeSqlIdentifier(column)} LIKE CONCAT('%', ?, '%')`)
          .join(" OR ");
        const genreParams = artistColumns.genreColumns.map(() => genre);

        const artistGenreMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `
            SELECT
              v.videoId,
              v.title,
              NULL AS channelTitle,
              v.favourited,
              v.description
            FROM artists a
            INNER JOIN videos v ON LOWER(TRIM(v.parsedArtist)) = LOWER(TRIM(a.${artistNameColumn}))
            WHERE (${genrePredicates})
              AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
              AND EXISTS (
                SELECT 1
                FROM site_videos sv
                WHERE sv.video_id = v.id
                  AND sv.status = 'available'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM site_videos sv
                WHERE sv.video_id = v.id
                  AND (sv.status IS NULL OR sv.status <> 'available')
              )
            GROUP BY v.videoId, v.title, v.favourited, v.description
            ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
            LIMIT ${fetchQueryLimit}
          `,
          ...genreParams,
        );

        considerRows(artistGenreMatchedVideos);
      }

    if (canResolveWindow()) {
      const resolved = resolveFromBestRows();
      storeGenreVideosInCache(resolved);
      return resolved;
    }

    const artists = options?.artists ?? (await getArtistsByGenre(genre));
    const artistNames = [...new Set(artists.map((artist) => artist.name).filter(Boolean))].slice(0, 32);

    if (artistNames.length === 0) {
      if (bestRows.length > 0) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const fallback = await getGenreFallback();
      storeGenreVideosInCache(fallback);
      return fallback;
    }

    const fulltextTerm = artistNames
      .map((name) => (name.includes(" ") ? `"${name}"` : name))
      .join(" ");

    const videos = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE MATCH(v.title, v.parsedArtist, v.parsedTrack) AGAINST (${fulltextTerm} IN BOOLEAN MODE)
        AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
      LIMIT ${fetchQueryLimit}
    `;

    considerRows(videos);

    if (canResolveWindow()) {
      const resolved = resolveFromBestRows();
      storeGenreVideosInCache(resolved);
      return resolved;
    }

    const normalizedArtistNames = artistNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0)
      .slice(0, 32);

    if (normalizedArtistNames.length > 0) {
      const placeholders = normalizedArtistNames.map(() => "?").join(", ");
      const artistMatchedVideos = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
        `
          SELECT
            v.videoId,
            v.title,
            NULL AS channelTitle,
            v.favourited,
            v.description
          FROM videos v
          WHERE LOWER(TRIM(v.parsedArtist)) IN (${placeholders})
            AND v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
            AND EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND sv.status = 'available'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM site_videos sv
              WHERE sv.video_id = v.id
                AND (sv.status IS NULL OR sv.status <> 'available')
            )
          ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
          LIMIT ${fetchQueryLimit}
        `,
        ...normalizedArtistNames,
      );

      considerRows(artistMatchedVideos);

      if (canResolveWindow()) {
        const resolved = resolveFromBestRows();
        storeGenreVideosInCache(resolved);
        return resolved;
      }
    }

    const normalizedGenreNeedle = `%${genre.trim().toLowerCase()}%`;
    const textMatchedVideos = await prisma.$queryRaw<RankedVideoRow[]>`
      SELECT
        v.videoId,
        v.title,
        NULL AS channelTitle,
        v.favourited,
        v.description
      FROM videos v
      WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'
        AND (
          LOWER(v.title) LIKE ${normalizedGenreNeedle}
          OR LOWER(COALESCE(v.description, '')) LIKE ${normalizedGenreNeedle}
          OR LOWER(COALESCE(v.parsedArtist, '')) LIKE ${normalizedGenreNeedle}
          OR LOWER(COALESCE(v.parsedTrack, '')) LIKE ${normalizedGenreNeedle}
        )
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND (sv.status IS NULL OR sv.status <> 'available')
        )
      ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
      LIMIT ${fetchQueryLimit}
    `;

    considerRows(textMatchedVideos);

    if (canResolveWindow()) {
      const resolved = resolveFromBestRows();
      storeGenreVideosInCache(resolved);
      return resolved;
    }

    if (bestRows.length > 0) {
      const resolved = resolveFromBestRows();
      storeGenreVideosInCache(resolved);
      return resolved;
    }

      const genreCardFallbackRows = await prisma.$queryRaw<Array<{ videoId: string; title: string; channelTitle: string | null; favourited: number | bigint | null; description: string | null }>>`
        SELECT
          v.videoId,
          v.title,
          NULL AS channelTitle,
          v.favourited,
          v.description
        FROM genre_cards gc
        INNER JOIN videos v
          ON CONVERT(v.videoId USING utf8mb4) = CONVERT(gc.thumbnail_video_id USING utf8mb4)
        INNER JOIN site_videos sv
          ON sv.video_id = v.id
         AND sv.status = 'available'
        WHERE LOWER(TRIM(gc.genre)) = LOWER(TRIM(${genre}))
        ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
        LIMIT 1
      `;

      if (genreCardFallbackRows.length > 0) {
        const resolved = genreCardFallbackRows
          .slice(requestedOffset, requestedOffset + requestedLimit)
          .map(mapVideo);
        storeGenreVideosInCache(resolved);
        return resolved;
      }

      const fallback = await getGenreFallback();
      storeGenreVideosInCache(fallback);
      return fallback;
    });
  } catch {
    const fallback = await getGenreFallback();
    storeGenreVideosInCache(fallback);
    return fallback;
  }
}

export async function getDataSourceStatus(): Promise<DataSourceStatus> {
  const envConfigured = hasDatabaseUrl();

  if (!envConfigured) {
    return {
      mode: "seed",
      envConfigured: false,
      videoCount: seedVideos.length,
      artistCount: seedArtists.length,
      genreCount: seedGenres.length,
      detail: "DATABASE_URL not set. Using seeded preview data.",
    };
  }

  try {
    const [videoCount, artistCount, genreCount] = await Promise.all([
      prisma.video.count(),
      prisma.artist.count(),
      prisma.genre.count(),
    ]);

    return {
      mode: "database",
      envConfigured: true,
      videoCount,
      artistCount,
      genreCount,
      detail: "Connected to the retained Yeh MySQL dataset.",
    };
  } catch {
    return {
      mode: "database-error",
      envConfigured: true,
      videoCount: seedVideos.length,
      artistCount: seedArtists.length,
      genreCount: seedGenres.length,
      detail: "DATABASE_URL is set, but the live database is not reachable yet. Falling back to seeded preview data.",
    };
  }
}

function getSeedPlaylists() {
  return getPreviewStore().playlistsByUser.get(PREVIEW_DEFAULT_USER_ID) ?? [];
}

function getPreviewUserId(userId?: number) {
  return userId ?? PREVIEW_DEFAULT_USER_ID;
}

function getPreviewPlaylists(userId?: number) {
  const store = getPreviewStore();
  const resolvedUserId = getPreviewUserId(userId);
  const existing = store.playlistsByUser.get(resolvedUserId);

  if (existing) {
    return existing;
  }

  const created = seedPlaylists.map((playlist) => ({
    ...playlist,
    videos: [...playlist.videos],
  }));
  store.playlistsByUser.set(resolvedUserId, created);
  return created;
}

function toPlaylistSummary(playlist: PlaylistDetail): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    itemCount: playlist.videos.length,
    leadVideoId: playlist.videos[0]?.id ?? seedVideos[0].id,
  };
}

export async function getPlaylists(userId?: number): Promise<PlaylistSummary[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  if (!userId) {
    return [];
  }

  try {
    type PlaylistSummaryRow = {
      id: number | bigint;
      name: string | null;
      itemCount: number | bigint;
      leadVideoId: string | null;
    };

    const rowsByLegacySchema = await (async () => {
      try {
        return await prisma.$queryRaw<PlaylistSummaryRow[]>`
          SELECT
            p.id AS id,
            p.name AS name,
            (
              SELECT COUNT(*)
              FROM playlistitems pi
              WHERE pi.playlistId = p.id
            ) AS itemCount,
            (
              SELECT pi.videoId
              FROM playlistitems pi
              WHERE pi.playlistId = p.id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS leadVideoId
          FROM playlistnames p
          WHERE p.userId = ${userId}
          ORDER BY p.id DESC
          LIMIT 24
        `;
      } catch {
        return [] as PlaylistSummaryRow[];
      }
    })();

    const rowsByMappedSchema = await (async () => {
      try {
        return await prisma.$queryRaw<PlaylistSummaryRow[]>`
          SELECT
            p.id AS id,
            p.name AS name,
            (
              SELECT COUNT(*)
              FROM playlistitems pi
              WHERE pi.playlist_id = p.id
            ) AS itemCount,
            (
              SELECT v.videoId
              FROM playlistitems pi
              LEFT JOIN videos v ON v.id = pi.video_id
              WHERE pi.playlist_id = p.id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS leadVideoId
          FROM playlistnames p
          WHERE p.user_id = ${userId}
          ORDER BY p.id DESC
          LIMIT 24
        `;
      } catch {
        return [] as PlaylistSummaryRow[];
      }
    })();

    const legacyTotal = rowsByLegacySchema.reduce((sum, row) => {
      const count = typeof row.itemCount === "bigint" ? Number(row.itemCount) : Number(row.itemCount ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    const mappedTotal = rowsByMappedSchema.reduce((sum, row) => {
      const count = typeof row.itemCount === "bigint" ? Number(row.itemCount) : Number(row.itemCount ?? 0);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    const rows = (() => {
      if (rowsByLegacySchema.length === 0 && rowsByMappedSchema.length > 0) {
        return rowsByMappedSchema;
      }

      if (rowsByMappedSchema.length === 0 && rowsByLegacySchema.length > 0) {
        return rowsByLegacySchema;
      }

      if (mappedTotal > legacyTotal) {
        return rowsByMappedSchema;
      }

      if (legacyTotal > mappedTotal) {
        return rowsByLegacySchema;
      }

      if (rowsByMappedSchema.length > rowsByLegacySchema.length) {
        return rowsByMappedSchema;
      }

      return rowsByLegacySchema;
    })();

    if (rows.length === 0) {
      return [];
    }

    return rows.map((row) => {
      const lead = typeof row.leadVideoId === "string" && row.leadVideoId.length > 0 ? row.leadVideoId : "__placeholder__";
      const count = typeof row.itemCount === "bigint" ? Number(row.itemCount) : Number(row.itemCount ?? 0);

      return {
        id: String(typeof row.id === "bigint" ? Number(row.id) : row.id),
        name: row.name ?? "Untitled Playlist",
        itemCount: Number.isFinite(count) ? count : 0,
        leadVideoId: lead,
      };
    });
  } catch {
    return [];
  }
}

export async function getPlaylistById(id: string, userId?: number): Promise<PlaylistDetail | null> {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericId = Number(id);

  if (!Number.isInteger(numericId)) {
    return null;
  }

  try {
    const playlistRowsByLegacyOwner = await (async () => {
      try {
        return await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
          SELECT id, name
          FROM playlistnames
          WHERE id = ${numericId} AND userId = ${userId}
          LIMIT 1
        `;
      } catch {
        return [] as Array<{ id: number | bigint; name: string | null }>;
      }
    })();

    const playlistRowsByMappedOwner = await (async () => {
      try {
        return await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
          SELECT id, name
          FROM playlistnames
          WHERE id = ${numericId} AND user_id = ${userId}
          LIMIT 1
        `;
      } catch {
        return [] as Array<{ id: number | bigint; name: string | null }>;
      }
    })();

    const playlist = playlistRowsByLegacyOwner[0] ?? playlistRowsByMappedOwner[0];

    if (!playlist) {
      return null;
    }

    type PlaylistDetailRow = RankedVideoRow & {
      playlistItemId: number | bigint;
    };

    const collapseToPlaylistItems = (rows: PlaylistDetailRow[]) => {
      const byPlaylistItemId = new Map<string, RankedVideoRow>();

      for (const row of rows) {
        const itemId = typeof row.playlistItemId === "bigint"
          ? row.playlistItemId.toString()
          : String(row.playlistItemId);

        if (byPlaylistItemId.has(itemId)) {
          continue;
        }

        byPlaylistItemId.set(itemId, {
          videoId: row.videoId,
          title: row.title,
          channelTitle: row.channelTitle,
          favourited: row.favourited,
          description: row.description,
        });
      }

      return [...byPlaylistItemId.entries()].map(([playlistItemId, video]) => ({
        ...video,
        playlistItemId,
      }));
    };

    const queryVariants: Array<() => Promise<PlaylistDetailRow[]>> = [
      async () =>
        prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
            pi.id AS playlistItemId,
            COALESCE(v.videoId, pi.videoId) AS videoId,
            COALESCE(v.title, CONCAT('Video ', pi.videoId)) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.videoId = pi.videoId
          WHERE pi.playlistId = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
          prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
              pi.id AS playlistItemId,
            COALESCE(v.videoId, CAST(pi.videoId AS CHAR)) AS videoId,
            COALESCE(v.title, CONCAT('Video ', CAST(pi.videoId AS CHAR))) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.id = pi.videoId
          WHERE pi.playlistId = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
          prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
              pi.id AS playlistItemId,
            COALESCE(v.videoId, CAST(pi.video_id AS CHAR)) AS videoId,
            COALESCE(v.title, CONCAT('Video ', CAST(pi.video_id AS CHAR))) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.id = pi.video_id
          WHERE pi.playlist_id = ${numericId}
          ORDER BY pi.id ASC
        `,
      async () =>
          prisma.$queryRaw<PlaylistDetailRow[]>`
          SELECT
              pi.id AS playlistItemId,
            COALESCE(v.videoId, pi.video_id) AS videoId,
            COALESCE(v.title, CONCAT('Video ', pi.video_id)) AS title,
            COALESCE(v.parsedArtist, NULL) AS channelTitle,
            COALESCE(v.favourited, 0) AS favourited,
            COALESCE(v.description, 'Playlist track') AS description
          FROM playlistitems pi
          LEFT JOIN videos v ON v.videoId = pi.video_id
          WHERE pi.playlist_id = ${numericId}
          ORDER BY pi.id ASC
        `,
    ];

    let videoRows: Array<RankedVideoRow & { playlistItemId: string }> = [];

    for (const query of queryVariants) {
      try {
        const rows = await query();
        const collapsed = collapseToPlaylistItems(rows);

        if (collapsed.length > videoRows.length) {
          videoRows = collapsed;
        }
      } catch {
        // Try next known schema variant.
      }
    }

    {
      const [playlistColumns, videoColumns] = await Promise.all([
        loadTableColumns("playlistitems"),
        loadTableColumns("videos"),
      ]);

      const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
      const videoRef = pickColumn(playlistColumns, ["video_id", "videoId", "videoid"]);
      const orderRef = pickColumn(playlistColumns, [
        "sort_order",
        "sortOrder",
        "display_order",
        "displayOrder",
        "order_index",
        "orderIndex",
        "position",
        "sequence",
        "idx",
        "id",
      ]);
      const rowIdRef = pickColumn(playlistColumns, ["id"]);
      const videoPkRef = pickColumn(videoColumns, ["id"]);
      const videoExternalIdRef = pickColumn(videoColumns, ["videoId", "video_id", "videoid"]);
      const videoTitleRef = pickColumn(videoColumns, ["title"]);
      const videoArtistRef = pickColumn(videoColumns, [
        "parsedArtist",
        "parsed_artist",
        "artist",
        "channelTitle",
        "channel_title",
        "channel",
      ]);
      const videoFavouritedRef = pickColumn(videoColumns, ["favourited", "favorite", "is_favourited"]);
      const videoDescriptionRef = pickColumn(videoColumns, ["description", "desc"]);
      const isPlaylistVideoRefNumeric = Boolean(videoRef && /int|bigint|smallint|tinyint/i.test(videoRef.Type));

      if (playlistRef && videoRef && orderRef && rowIdRef && videoExternalIdRef) {
        const playlistCol = escapeSqlIdentifier(playlistRef.Field);
        const videoCol = escapeSqlIdentifier(videoRef.Field);
        const orderCol = escapeSqlIdentifier(orderRef.Field);
        const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
        const externalVideoCol = escapeSqlIdentifier(videoExternalIdRef.Field);
        const titleExpr = videoTitleRef ? `v.${escapeSqlIdentifier(videoTitleRef.Field)}` : "NULL";
        const artistExpr = videoArtistRef
          ? `v.${escapeSqlIdentifier(videoArtistRef.Field)}`
          : "NULL";
        const favouritedExpr = videoFavouritedRef
          ? `v.${escapeSqlIdentifier(videoFavouritedRef.Field)}`
          : "0";
        const descriptionExpr = videoDescriptionRef
          ? `v.${escapeSqlIdentifier(videoDescriptionRef.Field)}`
          : "NULL";

        const joinCondition =
          isPlaylistVideoRefNumeric && videoPkRef
            ? `v.${escapeSqlIdentifier(videoPkRef.Field)} = pi.${videoCol}`
            : `v.${externalVideoCol} = pi.${videoCol}`;

        const unresolvedVideoExpr = isPlaylistVideoRefNumeric
          ? `CAST(pi.${videoCol} AS CHAR)`
          : `pi.${videoCol}`;

        try {
          const fallbackRows = await prisma.$queryRawUnsafe<PlaylistDetailRow[]>(
            `
              SELECT
                pi.${rowIdCol} AS playlistItemId,
                COALESCE(v.${externalVideoCol}, ${unresolvedVideoExpr}) AS videoId,
                COALESCE(${titleExpr}, CONCAT('Video ', ${unresolvedVideoExpr})) AS title,
                COALESCE(${artistExpr}, NULL) AS channelTitle,
                COALESCE(${favouritedExpr}, 0) AS favourited,
                COALESCE(${descriptionExpr}, 'Playlist track') AS description
              FROM playlistitems pi
              LEFT JOIN videos v ON ${joinCondition}
              WHERE pi.${playlistCol} = ?
              ORDER BY pi.${orderCol} ASC
            `,
            numericId,
          );

          const collapsed = collapseToPlaylistItems(fallbackRows);

          if (collapsed.length > 0) {
            // Prefer the dynamically ordered result so persisted reorders are reflected
            // even when earlier legacy queries returned the same row count ordered by id.
            videoRows = collapsed;
          }
        } catch {
          // Keep empty rows and return playlist shell below.
        }
      }
    }

    return {
      id: String(typeof playlist.id === "bigint" ? Number(playlist.id) : playlist.id),
      name: playlist.name ?? "Untitled Playlist",
      videos: videoRows.map((video) =>
        mapPlaylistVideo({
          playlistItemId: (video as RankedVideoRow & { playlistItemId: string }).playlistItemId,
          videoId: video.videoId,
          title: video.title,
          channelTitle: video.channelTitle,
          favourited: video.favourited,
          description: video.description,
        }),
      ),
    };
  } catch {
    return null;
  }
}

export async function getFavouriteVideos(userId?: number) {
  if (!userId || !hasDatabaseUrl()) {
    return [];
  }

  try {
    const favourites = await prisma.favourite.findMany({
      where: { userid: userId },
      select: { videoId: true },
      take: 50,
    });

    const youtubeIds = favourites
      .map((f) => f.videoId)
      .filter((id): id is string => Boolean(id));

    if (youtubeIds.length === 0) return [];

    const videos = await prisma.video.findMany({
      where: { videoId: { in: youtubeIds } },
      select: {
        videoId: true,
        title: true,
        favourited: true,
        description: true,
      },
    });

    const firstVideoById = new Map<string, (typeof videos)[number]>();

    for (const video of videos) {
      if (!firstVideoById.has(video.videoId)) {
        firstVideoById.set(video.videoId, video);
      }
    }

    const orderedVideos = youtubeIds
      .map((id) => firstVideoById.get(id))
      .filter((video): video is (typeof videos)[number] => Boolean(video));

    return orderedVideos.map((video) =>
      mapVideo({
        ...video,
        channelTitle: null,
      }),
    );
  } catch {
    return [];
  }
}

async function fetchRecentlyWatchedIds(userId: number, limit = 300): Promise<Set<string>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ videoId: string | null }>>`
      SELECT video_id AS videoId
      FROM watch_history
      WHERE user_id = ${userId}
      ORDER BY last_watched_at DESC
      LIMIT ${limit}
    `;
    return new Set(rows.map((r) => r.videoId).filter((id): id is string => Boolean(id)));
  } catch {
    return new Set<string>();
  }
}

export async function getSeenVideoIdsForUser(userId: number): Promise<Set<string>> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return new Set<string>();
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ videoId: string | null }>>`
      SELECT video_id AS videoId
      FROM watch_history
      WHERE user_id = ${userId}
    `;

    return new Set(rows.map((row) => row.videoId).filter((videoId): videoId is string => Boolean(videoId)));
  } catch {
    return new Set<string>();
  }
}

function cloneHiddenIdSet(ids: Set<string>) {
  return new Set(ids);
}

function cacheHiddenVideoIdsForUser(userId: number, ids: Set<string>) {
  hiddenVideoIdsCache.set(userId, {
    expiresAt: Date.now() + HIDDEN_VIDEO_IDS_CACHE_TTL_MS,
    ids: cloneHiddenIdSet(ids),
  });
}

function getCachedHiddenVideoIdsForUser(userId: number): Set<string> | undefined {
  const cached = hiddenVideoIdsCache.get(userId);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    hiddenVideoIdsCache.delete(userId);
    return undefined;
  }

  return cloneHiddenIdSet(cached.ids);
}

function updateCachedHiddenVideoIdsForUser(userId: number, videoId: string, hidden: boolean) {
  const cached = hiddenVideoIdsCache.get(userId);
  if (!cached || cached.expiresAt <= Date.now()) {
    hiddenVideoIdsCache.delete(userId);
    return;
  }

  const next = cloneHiddenIdSet(cached.ids);
  if (hidden) {
    next.add(videoId);
  } else {
    next.delete(videoId);
  }

  cacheHiddenVideoIdsForUser(userId, next);
}

async function loadHiddenVideoIdsForUser(userId: number): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ videoId: string | null }>>`
      SELECT video_id AS videoId
      FROM hidden_videos
      WHERE user_id = ${userId}
    `;

  const ids = new Set(rows.map((row) => row.videoId).filter((videoId): videoId is string => Boolean(videoId)));
  cacheHiddenVideoIdsForUser(userId, ids);
  return ids;
}

export async function getHiddenVideoIdsForUser(userId: number): Promise<Set<string>> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return new Set<string>();
  }

  const cached = getCachedHiddenVideoIdsForUser(userId);
  if (cached) {
    return cached;
  }

  const inFlight = hiddenVideoIdsInFlight.get(userId);
  if (inFlight) {
    return cloneHiddenIdSet(await inFlight);
  }

  const pending = loadHiddenVideoIdsForUser(userId);
  hiddenVideoIdsInFlight.set(userId, pending);

  try {
    return cloneHiddenIdSet(await pending);
  } catch {
    return new Set<string>();
  } finally {
    if (hiddenVideoIdsInFlight.get(userId) === pending) {
      hiddenVideoIdsInFlight.delete(userId);
    }
  }
}

export async function getHiddenVideoMatchesForUser(
  userId: number,
  candidateVideoIds: string[],
): Promise<Set<string>> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return new Set<string>();
  }

  const normalizedCandidates = [...new Set(candidateVideoIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (normalizedCandidates.length === 0) {
    return new Set<string>();
  }

  try {
    const hiddenIds = await getHiddenVideoIdsForUser(userId);
    const hidden = new Set<string>();

    for (const candidateVideoId of normalizedCandidates) {
      if (hiddenIds.has(candidateVideoId)) {
        hidden.add(candidateVideoId);
      }
    }

    return hidden;
  } catch {
    return new Set<string>();
  }
}

export async function getHiddenVideosForUser(userId: number, options?: { limit?: number; offset?: number }) {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return [] as HiddenVideoEntry[];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const hasChannelTitleColumn = await ensureVideoChannelTitleColumnAvailable();
  const channelTitleExpr = hasChannelTitleColumn
    ? "NULLIF(TRIM(v.channelTitle), '')"
    : "NULL";

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      videoId: string | null;
      title: string | null;
      parsedArtist: string | null;
      channelTitle: string | null;
      favourited: number | bigint | null;
      description: string | null;
      hiddenAt: Date | string | null;
    }>>(
      `
        SELECT
          hv.video_id AS videoId,
          COALESCE(v.title, CONCAT('Video ', hv.video_id)) AS title,
          NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
          ${channelTitleExpr} AS channelTitle,
          COALESCE(v.favourited, 0) AS favourited,
          COALESCE(v.description, 'Blocked track') AS description,
          hv.created_at AS hiddenAt
        FROM hidden_videos hv
        LEFT JOIN videos v ON v.videoId = hv.video_id
        WHERE hv.user_id = ?
        ORDER BY hv.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      userId,
    );

    return rows
      .filter((row) => typeof row.videoId === "string" && row.videoId.length > 0)
      .map((row) => ({
        video: mapVideo({
          videoId: row.videoId as string,
          title: row.title ?? "Unknown title",
          channelTitle: row.channelTitle,
          parsedArtist: row.parsedArtist,
          favourited: row.favourited ?? 0,
          description: row.description,
        }),
        hiddenAt: row.hiddenAt
          ? new Date(row.hiddenAt).toISOString()
          : new Date(0).toISOString(),
      }));
  } catch {
    return [] as HiddenVideoEntry[];
  }
}

export async function hideVideoForUser(input: { userId: number; videoId: string }) {
  const normalizedVideoId = normalizeYouTubeVideoId(input.videoId);
  if (!hasDatabaseUrl() || !normalizedVideoId || !Number.isInteger(input.userId) || input.userId <= 0) {
    return { ok: false as const };
  }

  try {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO hidden_videos (user_id, video_id)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE video_id = VALUES(video_id)
      `,
      input.userId,
      normalizedVideoId,
    );

    updateCachedHiddenVideoIdsForUser(input.userId, normalizedVideoId, true);

    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function hideVideoAndPrunePlaylistsForUser(input: {
  userId: number;
  videoId: string;
  activePlaylistId?: string | null;
}) {
  const normalizedVideoId = normalizeYouTubeVideoId(input.videoId);
  if (!hasDatabaseUrl() || !normalizedVideoId || !Number.isInteger(input.userId) || input.userId <= 0) {
    return {
      ok: false as const,
      removedItemCount: 0,
      removedFromPlaylistIds: [] as string[],
      deletedPlaylistIds: [] as string[],
      activePlaylistDeleted: false,
    };
  }

  const hideResult = await hideVideoForUser({
    userId: input.userId,
    videoId: normalizedVideoId,
  });

  if (!hideResult.ok) {
    return {
      ok: false as const,
      removedItemCount: 0,
      removedFromPlaylistIds: [] as string[],
      deletedPlaylistIds: [] as string[],
      activePlaylistDeleted: false,
    };
  }

  const removedFromPlaylistIds = new Set<string>();
  const deletedPlaylistIds = new Set<string>();
  let removedItemCount = 0;

  try {
    const playlists = await getPlaylists(input.userId);

    for (const playlist of playlists) {
      let current = await getPlaylistById(playlist.id, input.userId);

      if (!current || current.videos.length === 0) {
        continue;
      }

      let matchIndex = current.videos.findIndex((video) => (normalizeYouTubeVideoId(video.id) ?? video.id) === normalizedVideoId);

      while (matchIndex >= 0) {
        const match = current.videos[matchIndex];
        const updated = await removePlaylistItem(
          playlist.id,
          matchIndex,
          input.userId,
          match?.playlistItemId ?? null,
        );

        if (!updated) {
          break;
        }

        removedItemCount += 1;
        removedFromPlaylistIds.add(playlist.id);
        current = updated;
        matchIndex = current.videos.findIndex((video) => (normalizeYouTubeVideoId(video.id) ?? video.id) === normalizedVideoId);
      }

      if (!removedFromPlaylistIds.has(playlist.id)) {
        continue;
      }

      const refreshed = await getPlaylistById(playlist.id, input.userId);

      if (!refreshed || refreshed.videos.length === 0) {
        const deleted = await deletePlaylist(playlist.id, input.userId);
        if (deleted) {
          deletedPlaylistIds.add(playlist.id);
        }
      }
    }
  } catch {
    // Keep block/hide resilient even if playlist pruning partially fails.
  }

  return {
    ok: true as const,
    removedItemCount,
    removedFromPlaylistIds: [...removedFromPlaylistIds],
    deletedPlaylistIds: [...deletedPlaylistIds],
    activePlaylistDeleted: Boolean(
      input.activePlaylistId
      && deletedPlaylistIds.has(input.activePlaylistId),
    ),
  };
}

export async function unhideVideoForUser(input: { userId: number; videoId: string }) {
  const normalizedVideoId = normalizeYouTubeVideoId(input.videoId);
  if (!hasDatabaseUrl() || !normalizedVideoId || !Number.isInteger(input.userId) || input.userId <= 0) {
    return { ok: false as const };
  }

  try {
    await prisma.$executeRawUnsafe(
      `
        DELETE FROM hidden_videos
        WHERE user_id = ? AND video_id = ?
      `,
      input.userId,
      normalizedVideoId,
    );

    updateCachedHiddenVideoIdsForUser(input.userId, normalizedVideoId, false);

    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

async function fetchFavouriteVideoIds(userId: number, limit = 1000): Promise<Set<string>> {
  try {
    const rows = await prisma.favourite.findMany({
      where: { userid: userId },
      select: { videoId: true },
      take: limit,
    });

    return new Set(
      rows
        .map((row) => row.videoId)
        .filter((id): id is string => Boolean(id)),
    );
  } catch {
    return new Set<string>();
  }
}

export async function recordVideoWatch(input: {
  userId: number;
  videoId: string;
  reason?: "qualified" | "ended";
  positionSec?: number;
  durationSec?: number;
  progressPercent?: number;
}) {
  const normalizedVideoId = normalizeYouTubeVideoId(input.videoId);
  if (!hasDatabaseUrl() || !normalizedVideoId || !Number.isInteger(input.userId) || input.userId <= 0) {
    return { ok: false as const };
  }

  const positionSec = Math.max(0, Math.min(86_400, Math.floor(Number(input.positionSec ?? 0))));
  const durationSec = Math.max(0, Math.min(86_400, Math.floor(Number(input.durationSec ?? 0))));
  const progressPercent = Math.max(0, Math.min(100, Number(input.progressPercent ?? 0)));
  const now = new Date();

  try {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO watch_history (
          user_id,
          video_id,
          watch_count,
          first_watched_at,
          last_watched_at,
          last_position_sec,
          last_duration_sec,
          max_progress_percent
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          watch_count = IF(
            TIMESTAMPDIFF(SECOND, last_watched_at, VALUES(last_watched_at)) >= 600,
            watch_count + 1,
            watch_count
          ),
          last_watched_at = VALUES(last_watched_at),
          last_position_sec = VALUES(last_position_sec),
          last_duration_sec = VALUES(last_duration_sec),
          max_progress_percent = GREATEST(COALESCE(max_progress_percent, 0), VALUES(max_progress_percent))
      `,
      input.userId,
      normalizedVideoId,
      now,
      now,
      positionSec,
      durationSec,
      progressPercent,
    );

    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function getWatchHistory(userId: number, options?: { limit?: number; offset?: number }) {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return [] as WatchHistoryEntry[];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const hasChannelTitleColumn = await ensureVideoChannelTitleColumnAvailable();
  const channelTitleExpr = hasChannelTitleColumn
    ? "NULLIF(TRIM(v.channelTitle), '')"
    : "NULL";

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      videoId: string | null;
      title: string | null;
      parsedArtist: string | null;
      parsedTrack: string | null;
      channelTitle: string | null;
      favourited: number | bigint | null;
      description: string | null;
      lastWatchedAt: Date | string | null;
      watchCount: number | bigint | null;
      maxProgressPercent: number | null;
    }>>(
      `
        SELECT
          wh.video_id AS videoId,
          COALESCE(v.title, CONCAT('Video ', wh.video_id)) AS title,
          NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
          NULLIF(TRIM(v.parsedTrack), '') AS parsedTrack,
          ${channelTitleExpr} AS channelTitle,
          COALESCE(v.favourited, 0) AS favourited,
          COALESCE(v.description, 'Watched track') AS description,
          wh.last_watched_at AS lastWatchedAt,
          wh.watch_count AS watchCount,
          COALESCE(wh.max_progress_percent, 0) AS maxProgressPercent
        FROM watch_history wh
        LEFT JOIN videos v ON v.videoId = wh.video_id
        WHERE wh.user_id = ?
        ORDER BY wh.last_watched_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      userId,
    );

    return rows
      .filter((row) => typeof row.videoId === "string" && row.videoId.length > 0)
      .map((row) => {
        const videoTitle = row.title ?? "Unknown title";
        const normalizedTitle = videoTitle.trim().toLowerCase();

        // Resolve the best available artist name from the metadata fields.
        // 1. parsedArtist from the DB is the primary candidate.
        // 2. Reject it when it equals the video title (incorrectly stored track name).
        // 3. Fall back to the YouTube channelTitle column, then let mapVideo infer from title.
        let resolvedChannelTitle: string | null = null;

        const rawParsedArtist = typeof row.parsedArtist === "string" ? row.parsedArtist.trim() : null;

        if (rawParsedArtist) {
          const artistMatchesTitle = rawParsedArtist.toLowerCase() === normalizedTitle;
          if (!artistMatchesTitle) {
            resolvedChannelTitle = rawParsedArtist;
          }
          // else: parsedArtist == title (bad data), leave resolvedChannelTitle null so mapVideo infers.
        }

        // Secondary: use the stored YouTube channel name when parsedArtist was rejected/absent.
        if (!resolvedChannelTitle && row.channelTitle) {
          const channelMatchesTitle = row.channelTitle.trim().toLowerCase() === normalizedTitle;
          if (!channelMatchesTitle) {
            resolvedChannelTitle = row.channelTitle.trim();
          }
        }

        return ({
          video: mapVideo({
            videoId: row.videoId as string,
            title: videoTitle,
            // Pass null when no artist was resolved so mapVideo's title inference runs.
            channelTitle: resolvedChannelTitle,
            favourited: row.favourited ?? 0,
            description: row.description,
          }),
        lastWatchedAt: new Date(row.lastWatchedAt ?? Date.now()).toISOString(),
        watchCount: typeof row.watchCount === "bigint" ? Number(row.watchCount) : Number(row.watchCount ?? 0),
        maxProgressPercent: Number.isFinite(Number(row.maxProgressPercent ?? 0))
          ? Number(row.maxProgressPercent ?? 0)
          : 0,
        });
      });
  } catch {
    return [] as WatchHistoryEntry[];
  }
}

export async function updateFavourite(videoId: string, action: "add" | "remove", userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;

    if (action === "add") {
      const existing = await prisma.favourite.findFirst({
        where: { userid: userId, videoId: normalizedVideoId },
        select: { id: true },
      });

      if (!existing) {
        await prisma.favourite.create({
          data: { userid: userId, videoId: normalizedVideoId },
        });
      }
    } else {
      await prisma.favourite.deleteMany({
        where: { userid: userId, videoId: normalizedVideoId },
      });
    }

    const favouriteCount = await prisma.favourite.count({
      where: { videoId: normalizedVideoId },
    });

    await prisma.video.updateMany({
      where: { videoId: normalizedVideoId },
      data: { favourited: favouriteCount },
    });

    topPoolCache = undefined;
    const { invalidateTopVideosCache } = await import("@/lib/top-videos-cache");
    invalidateTopVideosCache();

    return {
      videoId: normalizedVideoId,
      isFavourite: action === "add",
      favourites: await getFavouriteVideos(userId),
    };
  }

  return {
    videoId,
    isFavourite: false,
    favourites: await getFavouriteVideos(userId),
  };
}

export async function createPlaylist(name: string, videoIds: string[] = [], userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const now = new Date();

    // The active DB schema for playlists can vary by environment; try known column shapes.
    let inserted = false;

    try {
      await prisma.$executeRaw`
        INSERT INTO playlistnames (userId, name, createdAt, updatedAt)
        VALUES (${userId}, ${name}, ${now}, ${now})
      `;
      inserted = true;
    } catch {
      // no-op, try alternative shape
    }

    if (!inserted) {
      try {
        await prisma.$executeRaw`
          INSERT INTO playlistnames (user_id, name, is_private)
          VALUES (${userId}, ${name}, ${false})
        `;
        inserted = true;
      } catch {
        // no-op, handled by final throw below
      }
    }

    if (!inserted) {
      throw new Error("Playlist insert failed for known playlistnames schemas.");
    }

    const insertedIdRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
      SELECT LAST_INSERT_ID() AS id
    `;
    const createdId = insertedIdRows[0]?.id;
    const playlistId = typeof createdId === "bigint" ? Number(createdId) : createdId;

    if (!playlistId) {
      throw new Error("Playlist inserted but id could not be resolved.");
    }

    if (videoIds.length > 0) {
      const uniqueVideoIds = [...new Set(videoIds.filter(Boolean))].slice(0, 50);

      for (const videoId of uniqueVideoIds) {
        const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;
        let linked = false;

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
            VALUES (${playlistId}, ${normalizedVideoId}, ${now}, ${now})
          `;
          linked = true;
        } catch {
          // Legacy shape not available in this environment; try additional known schemas below.
        }

        if (linked) {
          continue;
        }

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlistId, videoId)
            VALUES (${playlistId}, ${normalizedVideoId})
          `;
          linked = true;
        } catch {
          // Continue to modern schema attempts.
        }

        if (linked) {
          continue;
        }

        let videoPk: number | null = null;

        try {
          const videoRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM videos
            WHERE videoId = ${normalizedVideoId}
            LIMIT 1
          `;
          const resolvedId = videoRows[0]?.id;
          const parsedId = typeof resolvedId === "bigint" ? Number(resolvedId) : Number(resolvedId ?? NaN);
          if (Number.isInteger(parsedId)) {
            videoPk = parsedId;
          }
        } catch {
          videoPk = null;
        }

        if (videoPk === null) {
          continue;
        }

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlist_id, video_id, sort_order)
            VALUES (
              ${playlistId},
              ${videoPk},
              COALESCE((SELECT MAX(sort_order) + 1 FROM playlistitems WHERE playlist_id = ${playlistId}), 0)
            )
          `;
          linked = true;
        } catch {
          // Try final modern fallback.
        }

        if (linked) {
          continue;
        }

        try {
          await prisma.$executeRaw`
            INSERT INTO playlistitems (playlist_id, video_id)
            VALUES (${playlistId}, ${videoPk})
          `;
        } catch {
          // Keep base playlist creation successful even if one item linkage fails.
        }
      }
    }

    return {
      id: String(playlistId),
      name,
      videos: [],
    };
  }

  throw new Error("Playlist creation requires a configured database and authenticated user.");
}

export async function addPlaylistItem(playlistId: string, videoId: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericPlaylistId = Number(playlistId);
    const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;

    if (!Number.isInteger(numericPlaylistId)) {
      return null;
    }

    try {
      let ownerColumn: "userId" | "user_id" | null = null;

      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND userId = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "userId";
        }
      } catch {
        // Try alternative schema below.
      }

      if (!ownerColumn) {
        try {
          const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM playlistnames
            WHERE id = ${numericPlaylistId} AND user_id = ${userId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            ownerColumn = "user_id";
          }
        } catch {
          // no-op
        }
      }

      if (!ownerColumn) {
        return null;
      }

      const existingPlaylist = await getPlaylistById(String(numericPlaylistId), userId);
      if (existingPlaylist?.videos.some((video) => {
        const existingNormalizedId = normalizeYouTubeVideoId(video.id) ?? video.id;
        return existingNormalizedId === normalizedVideoId;
      })) {
        return existingPlaylist;
      }

      const now = new Date();
      let inserted = false;

      const legacyAttempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
              VALUES (${numericPlaylistId}, ${normalizedVideoId}, ${now}, ${now})
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId)
              VALUES (${numericPlaylistId}, ${normalizedVideoId})
            `,
          ),
      ];

      for (const attempt of legacyAttempts) {
        try {
          const changed = await attempt();
          if (changed > 0) {
            inserted = true;
            break;
          }
        } catch {
          // Try next known insert shape.
        }
      }

      if (!inserted) {
        let videoPk: number | null = null;

        try {
          const videoRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM videos
            WHERE videoId = ${normalizedVideoId}
            LIMIT 1
          `;
          const resolvedId = videoRows[0]?.id;
          videoPk = typeof resolvedId === "bigint" ? Number(resolvedId) : Number(resolvedId ?? NaN);

          if (!Number.isInteger(videoPk)) {
            videoPk = null;
          }
        } catch {
          videoPk = null;
        }

        if (videoPk !== null) {
          const modernAttempts: Array<() => Promise<number>> = [
            async () =>
              Number(
                await prisma.$executeRaw`
                  INSERT INTO playlistitems (playlist_id, video_id, sort_order)
                  VALUES (
                    ${numericPlaylistId},
                    ${videoPk},
                    COALESCE((SELECT MAX(sort_order) + 1 FROM playlistitems WHERE playlist_id = ${numericPlaylistId}), 0)
                  )
                `,
              ),
            async () =>
              Number(
                await prisma.$executeRaw`
                  INSERT INTO playlistitems (playlist_id, video_id)
                  VALUES (${numericPlaylistId}, ${videoPk})
                `,
              ),
          ];

          for (const attempt of modernAttempts) {
            try {
              const changed = await attempt();
              if (changed > 0) {
                inserted = true;
                break;
              }
            } catch {
              // Try next known insert shape.
            }
          }
        }
      }

      if (!inserted) {
        return null;
      }

      const resolvedPlaylist = await getPlaylistById(String(numericPlaylistId), userId);

      if (resolvedPlaylist) {
        return resolvedPlaylist;
      }

      const fallbackRows =
        ownerColumn === "userId"
          ? await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
              SELECT id, name
              FROM playlistnames
              WHERE id = ${numericPlaylistId} AND userId = ${userId}
              LIMIT 1
            `
          : await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
              SELECT id, name
              FROM playlistnames
              WHERE id = ${numericPlaylistId} AND user_id = ${userId}
              LIMIT 1
            `;

      const fallback = fallbackRows[0];

      if (!fallback) {
        return null;
      }

      return {
        id: String(typeof fallback.id === "bigint" ? Number(fallback.id) : fallback.id),
        name: fallback.name ?? "Untitled Playlist",
        videos: [],
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function addPlaylistItems(playlistId: string, videoIds: string[], userId?: number) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (!Number.isInteger(numericPlaylistId)) {
    return null;
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try alternative schema below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const existingPlaylist = await getPlaylistById(String(numericPlaylistId), userId);
    const existingIds = new Set(
      (existingPlaylist?.videos ?? []).map((video) => normalizeYouTubeVideoId(video.id) ?? video.id),
    );

    const uniqueVideoIds = [...new Set(videoIds.map((id) => normalizeYouTubeVideoId(id) ?? id).filter(Boolean))]
      .filter((id) => !existingIds.has(id));

    const now = new Date();

    for (const normalizedVideoId of uniqueVideoIds) {
      let linked = false;

      const legacyAttempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId, createdAt, updatedAt)
              VALUES (${numericPlaylistId}, ${normalizedVideoId}, ${now}, ${now})
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlistId, videoId)
              VALUES (${numericPlaylistId}, ${normalizedVideoId})
            `,
          ),
      ];

      for (const attempt of legacyAttempts) {
        try {
          const changed = await attempt();
          if (changed > 0) {
            linked = true;
            break;
          }
        } catch {
          // Try next known insert shape.
        }
      }

      if (linked) {
        continue;
      }

      let videoPk: number | null = null;

      try {
        const videoRows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM videos
          WHERE videoId = ${normalizedVideoId}
          LIMIT 1
        `;
        const resolvedId = videoRows[0]?.id;
        const parsedId = typeof resolvedId === "bigint" ? Number(resolvedId) : Number(resolvedId ?? NaN);
        if (Number.isInteger(parsedId)) {
          videoPk = parsedId;
        }
      } catch {
        videoPk = null;
      }

      if (videoPk === null) {
        continue;
      }

      const modernAttempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlist_id, video_id, sort_order)
              VALUES (
                ${numericPlaylistId},
                ${videoPk},
                COALESCE((SELECT MAX(sort_order) + 1 FROM playlistitems WHERE playlist_id = ${numericPlaylistId}), 0)
              )
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              INSERT INTO playlistitems (playlist_id, video_id)
              VALUES (${numericPlaylistId}, ${videoPk})
            `,
          ),
      ];

      for (const attempt of modernAttempts) {
        try {
          const changed = await attempt();
          if (changed > 0) {
            linked = true;
            break;
          }
        } catch {
          // Try next known insert shape.
        }
      }
    }

    const resolvedPlaylist = await getPlaylistById(String(numericPlaylistId), userId);

    if (resolvedPlaylist) {
      return resolvedPlaylist;
    }

    const fallbackRows =
      ownerColumn === "userId"
        ? await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
            SELECT id, name
            FROM playlistnames
            WHERE id = ${numericPlaylistId} AND userId = ${userId}
            LIMIT 1
          `
        : await prisma.$queryRaw<Array<{ id: number | bigint; name: string | null }>>`
            SELECT id, name
            FROM playlistnames
            WHERE id = ${numericPlaylistId} AND user_id = ${userId}
            LIMIT 1
          `;

    const fallback = fallbackRows[0];

    if (!fallback) {
      return null;
    }

    return {
      id: String(typeof fallback.id === "bigint" ? Number(fallback.id) : fallback.id),
      name: fallback.name ?? "Untitled Playlist",
      videos: [],
    };
  } catch {
    return null;
  }
}

export async function removePlaylistItem(
  playlistId: string,
  playlistItemIndex: number | null,
  userId?: number,
  playlistItemId?: string | null,
) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (
    !Number.isInteger(numericPlaylistId)
    || ((playlistItemId == null || playlistItemId.length === 0) && (!Number.isInteger(playlistItemIndex) || (playlistItemIndex ?? -1) < 0))
  ) {
    return null;
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try mapped owner column below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const playlistColumns = await loadTableColumns("playlistitems");
    const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
    const rowIdRef = pickColumn(playlistColumns, ["id"]);
    const orderRef = pickColumn(playlistColumns, [
      "sort_order",
      "sortOrder",
      "display_order",
      "displayOrder",
      "order_index",
      "orderIndex",
      "position",
      "sequence",
      "idx",
      "id",
    ]);

    if (!playlistRef || !rowIdRef || !orderRef) {
      return null;
    }

    const playlistCol = escapeSqlIdentifier(playlistRef.Field);
    const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
    const orderCol = escapeSqlIdentifier(orderRef.Field);

    const itemRows = await prisma.$queryRawUnsafe<Array<{ rowId: number | bigint }>>(
      `
        SELECT pi.${rowIdCol} AS rowId
        FROM playlistitems pi
        WHERE pi.${playlistCol} = ?
        ORDER BY pi.${orderCol} ASC, pi.${rowIdCol} ASC
      `,
      numericPlaylistId,
    );

    const target = playlistItemId
      ? itemRows.find((row) => String(typeof row.rowId === "bigint" ? row.rowId.toString() : row.rowId) === playlistItemId)
      : itemRows[playlistItemIndex ?? -1];

    if (!target) {
      return null;
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM playlistitems WHERE ${rowIdCol} = ? LIMIT 1`,
      typeof target.rowId === "bigint" ? Number(target.rowId) : target.rowId,
    );

    return await getPlaylistById(String(numericPlaylistId), userId);
  } catch {
    return null;
  }
}

export async function reorderPlaylistItems(
  playlistId: string,
  fromIndex: number | null,
  toIndex: number | null,
  userId?: number,
  fromPlaylistItemId?: string | null,
  toPlaylistItemId?: string | null,
) {
  if (!hasDatabaseUrl() || !userId) {
    return null;
  }

  const numericPlaylistId = Number(playlistId);

  if (
    !Number.isInteger(numericPlaylistId)
    || (
      (fromPlaylistItemId == null || fromPlaylistItemId.length === 0 || toPlaylistItemId == null || toPlaylistItemId.length === 0)
      && (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex))
    )
  ) {
    return null;
  }

  if (
    (fromPlaylistItemId == null || fromPlaylistItemId.length === 0 || toPlaylistItemId == null || toPlaylistItemId.length === 0)
    && ((fromIndex ?? -1) < 0 || (toIndex ?? -1) < 0)
  ) {
    return null;
  }

  if (
    (fromPlaylistItemId && toPlaylistItemId && fromPlaylistItemId === toPlaylistItemId)
    || (fromIndex !== null && toIndex !== null && fromIndex === toIndex)
  ) {
    return await getPlaylistById(String(numericPlaylistId), userId);
  }

  try {
    let ownerColumn: "userId" | "user_id" | null = null;

    try {
      const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
        SELECT id
        FROM playlistnames
        WHERE id = ${numericPlaylistId} AND userId = ${userId}
        LIMIT 1
      `;

      if (rows.length > 0) {
        ownerColumn = "userId";
      }
    } catch {
      // Try mapped owner column below.
    }

    if (!ownerColumn) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericPlaylistId} AND user_id = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "user_id";
        }
      } catch {
        // no-op
      }
    }

    if (!ownerColumn) {
      return null;
    }

    const playlistColumns = await loadTableColumns("playlistitems");
    const playlistRef = pickColumn(playlistColumns, ["playlist_id", "playlistId", "playlistid"]);
    const rowIdRef = pickColumn(playlistColumns, ["id"]);
    const orderRef = pickColumn(playlistColumns, [
      "sort_order",
      "sortOrder",
      "display_order",
      "displayOrder",
      "order_index",
      "orderIndex",
      "position",
      "sequence",
      "idx",
      "id",
    ]);

    if (!playlistRef || !rowIdRef || !orderRef) {
      return null;
    }

    // Reordering requires a mutable ordering column.
    if (orderRef.Field === "id") {
      return null;
    }

    const playlistCol = escapeSqlIdentifier(playlistRef.Field);
    const rowIdCol = escapeSqlIdentifier(rowIdRef.Field);
    const orderCol = escapeSqlIdentifier(orderRef.Field);

    const itemRows = await prisma.$queryRawUnsafe<Array<{ rowId: number | bigint }>>(
      `
        SELECT pi.${rowIdCol} AS rowId
        FROM playlistitems pi
        WHERE pi.${playlistCol} = ?
        ORDER BY pi.${orderCol} ASC, pi.${rowIdCol} ASC
      `,
      numericPlaylistId,
    );

    const resolvedFromIndex = fromPlaylistItemId
      ? itemRows.findIndex((row) => String(typeof row.rowId === "bigint" ? row.rowId.toString() : row.rowId) === fromPlaylistItemId)
      : (fromIndex ?? -1);
    const resolvedToIndex = toPlaylistItemId
      ? itemRows.findIndex((row) => String(typeof row.rowId === "bigint" ? row.rowId.toString() : row.rowId) === toPlaylistItemId)
      : (toIndex ?? -1);

    if (resolvedFromIndex < 0 || resolvedToIndex < 0 || resolvedFromIndex >= itemRows.length || resolvedToIndex >= itemRows.length) {
      return null;
    }

    const reordered = [...itemRows];
    const [moved] = reordered.splice(resolvedFromIndex, 1);

    if (!moved) {
      return null;
    }

    reordered.splice(resolvedToIndex, 0, moved);

    // Two-phase update avoids collisions when ordering column is unique/indexed.
    const tempOffset = reordered.length + 1024;

    for (let index = 0; index < reordered.length; index += 1) {
      const rowId = reordered[index]?.rowId;

      if (rowId === undefined || rowId === null) {
        continue;
      }

      const normalizedRowId = typeof rowId === "bigint" ? Number(rowId) : rowId;
      await prisma.$executeRawUnsafe(
        `UPDATE playlistitems SET ${orderCol} = ? WHERE ${rowIdCol} = ? LIMIT 1`,
        tempOffset + index,
        normalizedRowId,
      );
    }

    for (let index = 0; index < reordered.length; index += 1) {
      const rowId = reordered[index]?.rowId;

      if (rowId === undefined || rowId === null) {
        continue;
      }

      const normalizedRowId = typeof rowId === "bigint" ? Number(rowId) : rowId;
      await prisma.$executeRawUnsafe(
        `UPDATE playlistitems SET ${orderCol} = ? WHERE ${rowIdCol} = ? LIMIT 1`,
        index,
        normalizedRowId,
      );
    }

    return await getPlaylistById(String(numericPlaylistId), userId);
  } catch {
    return null;
  }
}

export async function renamePlaylist(playlistId: string, name: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericId = Number(playlistId);
    const trimmedName = name.trim();

    if (!Number.isInteger(numericId) || trimmedName.length < 2) {
      return false;
    }

    const now = new Date();

    try {
      const attempts: Array<() => Promise<number>> = [
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}, updatedAt = ${now}
              WHERE id = ${numericId} AND userId = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}
              WHERE id = ${numericId} AND userId = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}, updatedAt = ${now}
              WHERE id = ${numericId} AND user_id = ${userId}
            `,
          ),
        async () =>
          Number(
            await prisma.$executeRaw`
              UPDATE playlistnames
              SET name = ${trimmedName}
              WHERE id = ${numericId} AND user_id = ${userId}
            `,
          ),
      ];

      for (const attempt of attempts) {
        try {
          const changed = await attempt();

          if (changed > 0) {
            return true;
          }
        } catch {
          // Try the next known schema shape.
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  return false;
}

export async function deletePlaylist(playlistId: string, userId?: number) {
  if (hasDatabaseUrl() && userId) {
    const numericId = Number(playlistId);

    if (!Number.isInteger(numericId)) {
      return false;
    }

    try {
      let ownerColumn: "userId" | "user_id" | null = null;

      try {
        const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
          SELECT id
          FROM playlistnames
          WHERE id = ${numericId} AND userId = ${userId}
          LIMIT 1
        `;

        if (rows.length > 0) {
          ownerColumn = "userId";
        }
      } catch {
        // Try alternative schema below.
      }

      if (!ownerColumn) {
        try {
          const rows = await prisma.$queryRaw<Array<{ id: number | bigint }>>`
            SELECT id
            FROM playlistnames
            WHERE id = ${numericId} AND user_id = ${userId}
            LIMIT 1
          `;

          if (rows.length > 0) {
            ownerColumn = "user_id";
          }
        } catch {
          // no-op
        }
      }

      if (!ownerColumn) {
        return false;
      }

      try {
        await prisma.$executeRaw`
          DELETE FROM playlistitems
          WHERE playlistId = ${numericId}
        `;
      } catch {
        await prisma.$executeRaw`
          DELETE FROM playlistitems
          WHERE playlist_id = ${numericId}
        `;
      }

      const deleted =
        ownerColumn === "userId"
          ? await prisma.$executeRaw`
              DELETE FROM playlistnames
              WHERE id = ${numericId} AND userId = ${userId}
            `
          : await prisma.$executeRaw`
              DELETE FROM playlistnames
              WHERE id = ${numericId} AND user_id = ${userId}
            `;

      return Number(deleted) > 0;
    } catch {
      return false;
    }
  }

  return false;
}

export type PublicUserProfile = {
  id: number;
  screenName: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
};

export async function getPublicUserProfile(screenName: string): Promise<{
  user: PublicUserProfile | null;
  favourites: VideoRecord[];
  playlists: PlaylistSummary[];
}> {
  const empty = { user: null, favourites: [], playlists: [] };

  if (!screenName.trim() || !hasDatabaseUrl()) {
    return empty;
  }

  let user: PublicUserProfile | null = null;

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        screenName: string | null;
        avatarUrl: string | null;
        bio: string | null;
        location: string | null;
      }>
    >`
      SELECT id, screen_name AS screenName, avatar_url AS avatarUrl, bio, location
      FROM users
      WHERE screen_name = ${screenName}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row || !row.screenName) {
      return empty;
    }

    user = {
      id: Number(row.id),
      screenName: row.screenName,
      avatarUrl: row.avatarUrl ?? null,
      bio: row.bio ?? null,
      location: row.location ?? null,
    };
  } catch {
    return empty;
  }

  const [favourites, playlists] = await Promise.all([
    getFavouriteVideos(user.id),
    getPlaylists(user.id),
  ]);

  return { user, favourites, playlists };
}

export async function getPublicPlaylistVideos(userId: number, playlistId: string): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  try {
    const playlist = await getPlaylistById(playlistId, userId);
    return playlist?.videos ?? [];
  } catch {
    return [];
  }
}

/**
 * Filter videos to exclude hidden/blocked videos for a user.
 * Returns a new array with only non-hidden videos.
 */
export async function filterHiddenVideos<T extends { id: string } | { videoId: string }>(
  videos: T[],
  userId?: number,
): Promise<T[]> {
  if (!userId || !hasDatabaseUrl()) {
    return videos;
  }

  const videoIds = videos.map((video) => ("videoId" in video ? video.videoId : video.id));
  const hiddenIds = await getHiddenVideoMatchesForUser(userId, videoIds);
  if (hiddenIds.size === 0) {
    return videos;
  }

  return videos.filter((video) => {
    const videoId = "videoId" in video ? video.videoId : video.id;
    return !hiddenIds.has(videoId);
  });
}

