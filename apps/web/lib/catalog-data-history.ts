/**
 * catalog-data-history.ts
 * Watch history and seen-video-ids domain.
 */

import { prisma } from "@/lib/db";
import { BoundedMap } from "@/lib/bounded-map";
import { createSeenVideoIdCache } from "@/lib/seen-video-id-cache";
import type { WatchHistoryEntry } from "@/lib/catalog-data-utils";
import { hasDatabaseUrl, mapVideo, normalizeYouTubeVideoId } from "@/lib/catalog-data-utils";
import { ensureVideoChannelTitleColumnAvailable } from "@/lib/catalog-data-db";

// ── Constants & caches ────────────────────────────────────────────────────────

const USER_SCOPED_CACHE_MAX_ENTRIES = Math.max(
  100,
  Math.min(10_000, Number(process.env.USER_SCOPED_CACHE_MAX_ENTRIES || "1500")),
);

const SEEN_VIDEO_IDS_CACHE_TTL_MS = 20_000;
const seenVideoIdsCache = createSeenVideoIdCache(SEEN_VIDEO_IDS_CACHE_TTL_MS, {
  maxEntries: USER_SCOPED_CACHE_MAX_ENTRIES,
});
const seenVideoIdsInFlight = new BoundedMap<number, Promise<Set<string>>>(
  USER_SCOPED_CACHE_MAX_ENTRIES,
);

const SEEN_VIDEO_IDS_METRICS_LOG_INTERVAL_MS = 60_000;
const SEEN_VIDEO_IDS_METRICS_LOG_EVERY_LOOKUPS = 250;
const seenVideoIdsCacheMetrics = {
  lookups: 0,
  hits: 0,
  misses: 0,
  inFlightReuses: 0,
  dbLoads: 0,
  dbErrors: 0,
  lastLoggedAt: 0,
};

// ── Metrics ───────────────────────────────────────────────────────────────────

export function markSeenVideoIdsCacheMetric(
  event: "hit" | "miss" | "inflight-reuse" | "db-load" | "db-error",
) {
  if (event === "hit" || event === "miss" || event === "inflight-reuse") {
    seenVideoIdsCacheMetrics.lookups += 1;
  }

  switch (event) {
    case "hit":
      seenVideoIdsCacheMetrics.hits += 1;
      break;
    case "miss":
      seenVideoIdsCacheMetrics.misses += 1;
      break;
    case "inflight-reuse":
      seenVideoIdsCacheMetrics.inFlightReuses += 1;
      break;
    case "db-load":
      seenVideoIdsCacheMetrics.dbLoads += 1;
      break;
    case "db-error":
      seenVideoIdsCacheMetrics.dbErrors += 1;
      break;
  }

  if (seenVideoIdsCacheMetrics.lookups === 0) {
    return;
  }

  const now = Date.now();
  const shouldLogByInterval =
    now - seenVideoIdsCacheMetrics.lastLoggedAt >= SEEN_VIDEO_IDS_METRICS_LOG_INTERVAL_MS;
  const shouldLogByCount =
    seenVideoIdsCacheMetrics.lookups % SEEN_VIDEO_IDS_METRICS_LOG_EVERY_LOOKUPS === 0;

  if (!shouldLogByInterval && !shouldLogByCount) {
    return;
  }

  seenVideoIdsCacheMetrics.lastLoggedAt = now;
  const { lookups, hits, misses, inFlightReuses, dbLoads, dbErrors } = seenVideoIdsCacheMetrics;
  const avoidedDbReads = hits + inFlightReuses;
  const hitRatePercent = lookups > 0 ? Number(((hits / lookups) * 100).toFixed(1)) : 0;
  const avoidedDbPercent =
    lookups > 0 ? Number(((avoidedDbReads / lookups) * 100).toFixed(1)) : 0;

  console.info("[seen-video-ids-cache]", {
    lookups,
    hits,
    misses,
    inFlightReuses,
    dbLoads,
    dbErrors,
    hitRatePercent,
    avoidedDbPercent,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchRecentlyWatchedIds(userId: number, limit = 300): Promise<Set<string>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ videoId: string | null }>>`
      SELECT video_id AS videoId
      FROM watch_history
      WHERE user_id = ${userId}
      ORDER BY last_watched_at DESC
      LIMIT ${limit}
    `;
    return new Set(
      rows.map((r) => r.videoId).filter((id): id is string => Boolean(id)),
    );
  } catch {
    return new Set<string>();
  }
}

export async function getSeenVideoIdsForUser(userId: number): Promise<Set<string>> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return new Set<string>();
  }

  const cached = seenVideoIdsCache.get(userId);
  if (cached) {
    markSeenVideoIdsCacheMetric("hit");
    return cached;
  }

  markSeenVideoIdsCacheMetric("miss");

  const inFlight = seenVideoIdsInFlight.get(userId);
  if (inFlight) {
    markSeenVideoIdsCacheMetric("inflight-reuse");
    return new Set(await inFlight);
  }

  const pending = (async () => {
    markSeenVideoIdsCacheMetric("db-load");
    const rows = await prisma.$queryRaw<Array<{ videoId: string | null }>>`
      SELECT video_id AS videoId
      FROM watch_history
      WHERE user_id = ${userId}
    `;

    const ids = new Set(
      rows.map((row) => row.videoId).filter((videoId): videoId is string => Boolean(videoId)),
    );
    seenVideoIdsCache.set(userId, ids);
    return ids;
  })();
  seenVideoIdsInFlight.set(userId, pending);

  try {
    return new Set(await pending);
  } catch {
    markSeenVideoIdsCacheMetric("db-error");
    return new Set<string>();
  } finally {
    if (seenVideoIdsInFlight.get(userId) === pending) {
      seenVideoIdsInFlight.delete(userId);
    }
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
  if (
    !hasDatabaseUrl() ||
    !normalizedVideoId ||
    !Number.isInteger(input.userId) ||
    input.userId <= 0
  ) {
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

    seenVideoIdsCache.add(input.userId, normalizedVideoId);

    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function getWatchHistory(
  userId: number,
  options?: { limit?: number; offset?: number },
): Promise<WatchHistoryEntry[]> {
  if (!hasDatabaseUrl() || !Number.isInteger(userId) || userId <= 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const hasChannelTitleColumn = await ensureVideoChannelTitleColumnAvailable();
  const channelTitleExpr = hasChannelTitleColumn ? "NULLIF(TRIM(v.channelTitle), '')" : "NULL";

  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
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
      }>
    >(
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

        let resolvedChannelTitle: string | null = null;

        const rawParsedArtist =
          typeof row.parsedArtist === "string" ? row.parsedArtist.trim() : null;

        if (rawParsedArtist) {
          const artistMatchesTitle = rawParsedArtist.toLowerCase() === normalizedTitle;
          if (!artistMatchesTitle) {
            resolvedChannelTitle = rawParsedArtist;
          }
        }

        if (!resolvedChannelTitle && row.channelTitle) {
          const channelMatchesTitle =
            row.channelTitle.trim().toLowerCase() === normalizedTitle;
          if (!channelMatchesTitle) {
            resolvedChannelTitle = row.channelTitle.trim();
          }
        }

        return {
          video: mapVideo({
            videoId: row.videoId as string,
            title: videoTitle,
            channelTitle: resolvedChannelTitle,
            favourited: row.favourited ?? 0,
            description: row.description,
          }),
          lastWatchedAt: new Date(row.lastWatchedAt ?? Date.now()).toISOString(),
          watchCount:
            typeof row.watchCount === "bigint"
              ? Number(row.watchCount)
              : Number(row.watchCount ?? 0),
          maxProgressPercent: Number.isFinite(Number(row.maxProgressPercent ?? 0))
            ? Number(row.maxProgressPercent ?? 0)
            : 0,
        };
      });
  } catch {
    return [];
  }
}

export function clearHistoryCaches() {
  seenVideoIdsCache.clear();
  seenVideoIdsInFlight.clear();
}
