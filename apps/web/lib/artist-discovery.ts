/**
 * Shared artist discovery logic.
 *
 * Used by both the admin "Discover more tracks" button endpoint and by the
 * automatic trigger that fires when a video is approved from a previously
 * unseen artist.
 */
import { prisma } from "@/lib/db";
import {
  getStoredVideoById,
  hasDatabaseUrl,
  importVideoFromDirectSource,
  normalizeArtistKey,
  normalizeYouTubeVideoId,
  pruneVideoAndAssociationsByVideoId,
} from "@/lib/catalog-data";
import { parseJsonOrNull } from "@/lib/parse-json";
import { recordExternalApiUsage } from "@/lib/api-usage-telemetry";

const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY?.trim() || "";

type YouTubeSearchResponse = {
  items?: Array<{
    id?: {
      videoId?: string;
    };
  }>;
};

export type ArtistDiscoveryResult = {
  ok: boolean;
  artistName: string;
  scanned: number;
  imported: number;
  queued: number;
  skipped: number;
  prunedAsMismatch: number;
  error?: string;
};

/**
 * Core discovery logic: search YouTube for an artist and import matching tracks.
 * Shared between the admin button endpoint and the post-approval auto-trigger.
 */
export async function discoverTracksForArtist(
  artistName: string,
  maxResults = 20,
): Promise<ArtistDiscoveryResult> {
  const normalizedRequestedArtist = normalizeArtistKey(artistName);

  if (!hasDatabaseUrl()) {
    return { ok: false, error: "Database is not configured.", artistName, scanned: 0, imported: 0, queued: 0, skipped: 0, prunedAsMismatch: 0 };
  }

  if (!YOUTUBE_DATA_API_KEY) {
    return { ok: false, error: "YouTube API key is not configured.", artistName, scanned: 0, imported: 0, queued: 0, skipped: 0, prunedAsMismatch: 0 };
  }

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("videoCategoryId", "10");
  endpoint.searchParams.set("maxResults", String(maxResults));
  endpoint.searchParams.set("order", "relevance");
  endpoint.searchParams.set("q", `"${artistName}" official music video`);
  endpoint.searchParams.set("key", YOUTUBE_DATA_API_KEY);

  const response = await fetch(endpoint, {
    headers: { "User-Agent": "YehThatRocks/1.0" },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    void recordExternalApiUsage({
      provider: "youtube",
      endpoint: "search.list",
      units: 100,
      success: false,
      statusCode: response?.status ?? null,
      note: "artist-discovery-search-failed",
    });
    return { ok: false, error: "Could not query YouTube for this artist.", artistName, scanned: 0, imported: 0, queued: 0, skipped: 0, prunedAsMismatch: 0 };
  }

  void recordExternalApiUsage({
    provider: "youtube",
    endpoint: "search.list",
    units: 100,
    success: true,
    statusCode: response.status,
    note: "artist-discovery-search",
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
    return { ok: true, artistName, scanned: 0, imported: 0, queued: 0, skipped: 0, prunedAsMismatch: 0 };
  }

  let imported = 0;
  let queued = 0;
  let skipped = 0;
  let prunedAsMismatch = 0;

  const BATCH_SIZE = 4;
  const processCandidate = async (videoId: string) => {
    const existedBefore = Boolean(await getStoredVideoById(videoId, { includeUnapproved: true }));
    if (existedBefore) return { action: "skip" as const };

    const result = await importVideoFromDirectSource(videoId, {
      discoverRelated: false,
      skipEmbedCheck: true,
      deferMetadataClassification: true,
    });

    if (!result.videoId || !result.decision.allowed) return { action: "skip" as const };

    const persisted = await getStoredVideoById(videoId, { includeUnapproved: true });
    const parsedArtist = (persisted?.parsedArtist ?? persisted?.channelTitle ?? "").trim();
    const normalizedParsedArtist = parsedArtist ? normalizeArtistKey(parsedArtist) : "";
    const isArtistMatch = normalizedParsedArtist.length > 0 && normalizedParsedArtist === normalizedRequestedArtist;

    if (!isArtistMatch) {
      await pruneVideoAndAssociationsByVideoId(videoId, "artist-discovery-artist-mismatch").catch(() => undefined);
      return { action: "prune_mismatch" as const };
    }

    return { action: "queued" as const };
  };

  for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
    const batch = candidateIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(processCandidate));
    for (const r of results) {
      if (r.action === "skip") skipped += 1;
      else if (r.action === "prune_mismatch") { imported += 1; prunedAsMismatch += 1; }
      else if (r.action === "queued") { imported += 1; queued += 1; }
    }
  }

  return { ok: true, artistName, scanned: candidateIds.length, imported, queued, skipped, prunedAsMismatch };
}

/**
 * Check whether the given video is the first approved video for its artist.
 * If so, fire an asynchronous discovery to find more tracks by that artist.
 *
 * Call this after a video has been approved.
 */
export function triggerArtistDiscoveryIfNew(artistName: string, currentVideoId: string): void {
  const normalizedArtist = normalizeArtistKey(artistName);
  if (!normalizedArtist) return;

  // Fire-and-forget: do not block the approval response.
  void (async () => {
    try {
      // Check if any OTHER approved video exists for this artist.
      const existing = await prisma.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
        `SELECT COUNT(*) AS cnt
         FROM videos
         WHERE LOWER(TRIM(COALESCE(parsedArtist, ''))) = ?
           AND COALESCE(approved, 0) = 1
           AND videoId != ?
         LIMIT 1`,
        normalizedArtist,
        currentVideoId,
      );

      const otherApprovedCount = Number(existing[0]?.cnt ?? 0);
      if (otherApprovedCount > 0) {
        // Artist is not new — other approved videos already exist.
        return;
      }

      // First approved video for this artist — trigger discovery.
      await discoverTracksForArtist(artistName, 20);
    } catch {
      // Best-effort: discovery failures must never affect the approval flow.
    }
  })();
}
