/**
 * catalog-data-videos.ts
 * Core video domain: top pool, related, current, newest, search, suggestions.
 */

import { prisma } from "@/lib/db";
import { BoundedMap } from "@/lib/bounded-map";
import type { VideoRecord } from "@/lib/catalog";
import type {
  RankedVideoRow,
  DataSourceStatus,
  SearchSuggestion,
} from "@/lib/catalog-data-utils";
import {
  hasDatabaseUrl,
  mapVideo,
  mapVideoRecordToRankedRow,
  normalizeYouTubeVideoId,
  dedupeRankedRows,
  selectUniqueVideoRows,
  rotateRowsBySeed,
  withSoftTimeout,
  intersectVideoIdsWithCandidates,
  debugCatalog,
  slugify,
  getGenreSlug,
  normalizeArtistKey,
  seedVideos,
  seedArtists,
  seedGenres,
  searchSeedCatalog,
  getSeedVideoById,
  escapeSqlIdentifier,
  ENABLE_SAME_GENRE_RELATED,
} from "@/lib/catalog-data-utils";
import {
  loadTableColumns,
  pickColumn,
  getStoredVideoById,
  AVAILABLE_SITE_VIDEOS_JOIN,
} from "@/lib/catalog-data-db";
import {
  getArtistVideoPoolByNormalizedName,
  getSameGenreRelatedPoolByArtist,
  getArtists,
  findArtistsInDatabase,
  findArtistsFromVideoMetadata,
} from "@/lib/catalog-data-artists";
import { getInteractiveTableCount } from "@/lib/interactive-table-counts";
import {
  getVideoPlaybackDecision,
  maybeStartAutomaticRelatedBackfill,
  pruneVideoAndAssociationsByVideoId,
} from "@/lib/catalog-data-video-ingestion";
import {
  fetchFavouriteVideoIds,
  getFavouriteVideosInternal,
  getFavouriteVideos,
} from "@/lib/catalog-data-favourites";
import { fetchRecentlyWatchedIds, getSeenVideoIdsForUser } from "@/lib/catalog-data-history";
import { getSearchRankingSignals } from "@/lib/search-flag-data";

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_POOL_CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_RANKED_TOP_POOL_FETCH = 200;
const RANKED_VIDEO_ID_SLICE_CACHE_TTL_MS = Math.max(
  15_000,
  Math.min(60_000, Number(process.env.RANKED_VIDEO_ID_SLICE_CACHE_TTL_MS || "30000")),
);

const NEWEST_CACHE_TTL_MS = 60_000;
const RELATED_VIDEOS_CACHE_TTL_MS = 20_000;
const RELATED_BASE_ROWS_CACHE_TTL_MS = 30_000;
const REJECTED_VIDEO_CACHE_TTL_MS = 5 * 60_000;
const SUGGEST_CACHE_TTL_MS = 10_000;
const VIDEO_CACHE_MAX_ENTRIES = Math.max(
  200,
  Math.min(8_000, Number(process.env.VIDEO_CACHE_MAX_ENTRIES || "1500")),
);
const RANKED_SLICE_CACHE_MAX_ENTRIES = 8;
const ENABLE_LEGACY_APPROVAL_BOOTSTRAP = process.env.ENABLE_LEGACY_APPROVAL_BOOTSTRAP === "1";

// ── Cache variables ───────────────────────────────────────────────────────────

let topPoolCache: { expiresAt: number; rows: RankedVideoRow[] } | undefined;
let topPoolInFlight: { limit: number; promise: Promise<RankedVideoRow[]> } | undefined;
const rankedVideoIdSliceCache = new BoundedMap<
  "top" | "newest",
  { expiresAt: number; ids: string[] }
>(RANKED_SLICE_CACHE_MAX_ENTRIES);
const rankedVideoIdSliceInFlight = new BoundedMap<
  "top" | "newest",
  { limit: number; promise: Promise<string[]> }
>(RANKED_SLICE_CACHE_MAX_ENTRIES);

let newestVideosCache:
  | { expiresAt: number; count: number; rows: RankedVideoRow[] }
  | undefined;
const newestVideosRequestCache = new BoundedMap<string, { expiresAt: number; videos: VideoRecord[] }>(VIDEO_CACHE_MAX_ENTRIES);
const newestVideosInFlight = new BoundedMap<string, Promise<VideoRecord[]>>(VIDEO_CACHE_MAX_ENTRIES);

const rejectedVideoCache = new BoundedMap<string, { expiresAt: number; rejected: boolean }>(VIDEO_CACHE_MAX_ENTRIES);

const relatedVideosCache = new BoundedMap<string, { expiresAt: number; videos: VideoRecord[] }>(VIDEO_CACHE_MAX_ENTRIES);
const relatedVideosInFlight = new BoundedMap<
  string,
  { count: number; promise: Promise<VideoRecord[]> }
>(VIDEO_CACHE_MAX_ENTRIES);

type RelatedBaseRowBuckets = {
  directRows: RankedVideoRow[];
  sameArtistRows: RankedVideoRow[];
  newestRows: RankedVideoRow[];
  topPoolRows: RankedVideoRow[];
  sameGenreRows: RankedVideoRow[];
};

const relatedBaseRowsCache = new BoundedMap<
  string,
  { expiresAt: number; rows: RelatedBaseRowBuckets }
>(VIDEO_CACHE_MAX_ENTRIES);
const relatedBaseRowsInFlight = new BoundedMap<string, Promise<RelatedBaseRowBuckets>>(VIDEO_CACHE_MAX_ENTRIES);

const suggestCacheMap = new BoundedMap<string, { expiresAt: number; results: SearchSuggestion[] }>(VIDEO_CACHE_MAX_ENTRIES);
const suggestInFlightMap = new BoundedMap<string, Promise<SearchSuggestion[]>>(VIDEO_CACHE_MAX_ENTRIES);

// Bootstrap legacy approval state
let legacyApprovalBootstrapAttempted = false;
let legacyApprovalBootstrapInFlight: Promise<boolean> | null = null;

// ── Cache management ──────────────────────────────────────────────────────────

export function clearVideosCaches() {
  topPoolCache = undefined;
  topPoolInFlight = undefined;
  rankedVideoIdSliceCache.clear();
  rankedVideoIdSliceInFlight.clear();
  newestVideosCache = undefined;
  newestVideosRequestCache.clear();
  newestVideosInFlight.clear();
  relatedVideosCache.clear();
  relatedBaseRowsCache.clear();
  relatedBaseRowsInFlight.clear();
  suggestCacheMap.clear();
  suggestInFlightMap.clear();
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function maybeBackfillLegacyApprovedVideos() {
  // Safety default: never auto-approve pending videos in modern deployments.
  // This legacy bootstrap can be explicitly enabled only for one-off migrations.
  if (!ENABLE_LEGACY_APPROVAL_BOOTSTRAP) {
    return false;
  }

  if (legacyApprovalBootstrapAttempted) {
    return false;
  }

  if (legacyApprovalBootstrapInFlight) {
    return legacyApprovalBootstrapInFlight;
  }

  legacyApprovalBootstrapInFlight = (async () => {
    legacyApprovalBootstrapAttempted = true;

    if (!hasDatabaseUrl()) {
      return false;
    }

    try {
      const rows = await prisma.$queryRaw<
        Array<{ total: bigint | number; approved: bigint | number }>
      >`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN COALESCE(approved, 0) = 1 THEN 1 ELSE 0 END) AS approved
        FROM videos
      `;

      const total = Number(rows[0]?.total ?? 0);
      const approved = Number(rows[0]?.approved ?? 0);

      if (!Number.isFinite(total) || total <= 0 || approved > 0) {
        return false;
      }

      const updated = await prisma.$executeRaw`
        UPDATE videos
        SET approved = 1
        WHERE COALESCE(approved, 0) = 0
      `;

      if (Number(updated) > 0) {
        clearVideosCaches();
        debugCatalog("bootstrap-approval-backfill:updated", { total, updated: Number(updated) });
        return true;
      }

      return false;
    } catch {
      return false;
    } finally {
      legacyApprovalBootstrapInFlight = null;
    }
  })();

  return legacyApprovalBootstrapInFlight;
}

async function getRankedVideoIdSlice(mode: "top" | "newest", limit: number): Promise<string[]> {
  const fetchLimit = Math.max(1, Math.floor(limit));
  const now = Date.now();
  const cached = rankedVideoIdSliceCache.get(mode);

  if (cached && cached.expiresAt > now && cached.ids.length >= fetchLimit) {
    return cached.ids.slice(0, fetchLimit);
  }

  const inFlight = rankedVideoIdSliceInFlight.get(mode);
  if (inFlight && inFlight.limit >= fetchLimit) {
    const ids = await inFlight.promise;
    return ids.slice(0, fetchLimit);
  }

  const queryPromise = (async () => {
    const rows = mode === "top"
      ? await prisma.$queryRaw<Array<{ videoId: string }>>`
          SELECT
            v.videoId
          FROM videos v
          INNER JOIN (
            SELECT DISTINCT sv.video_id
            FROM site_videos sv FORCE INDEX (idx_site_videos_status_video_id)
            WHERE sv.status = 'available'
          ) available_sv ON available_sv.video_id = v.id
          WHERE v.videoId IS NOT NULL
            AND COALESCE(v.approved, 0) = 1
          ORDER BY COALESCE(v.favourited, 0) DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
          LIMIT ${fetchLimit}
        `
      : await prisma.$queryRaw<Array<{ videoId: string }>>`
          SELECT
            v.videoId
          FROM videos v FORCE INDEX (idx_videos_created_at_id)
          INNER JOIN (
            SELECT DISTINCT sv.video_id
            FROM site_videos sv FORCE INDEX (idx_site_videos_status_video_id)
            WHERE sv.status = 'available'
          ) available_sv ON available_sv.video_id = v.id
          WHERE v.videoId IS NOT NULL
            AND COALESCE(v.approved, 0) = 1
          ORDER BY v.created_at DESC, v.id DESC
          LIMIT ${fetchLimit}
        `;

    const ids = Array.from(new Set(rows.map((row) => row.videoId).filter(Boolean))).slice(0, fetchLimit);

    rankedVideoIdSliceCache.set(mode, {
      expiresAt: Date.now() + RANKED_VIDEO_ID_SLICE_CACHE_TTL_MS,
      ids,
    });

    return ids;
  })();

  rankedVideoIdSliceInFlight.set(mode, {
    limit: fetchLimit,
    promise: queryPromise,
  });

  try {
    return (await queryPromise).slice(0, fetchLimit);
  } finally {
    if (rankedVideoIdSliceInFlight.get(mode)?.promise === queryPromise) {
      rankedVideoIdSliceInFlight.delete(mode);
    }
  }
}

async function getRankedTopPool(limit = 129): Promise<RankedVideoRow[]> {
  const fetchLimit = Math.max(limit, MIN_RANKED_TOP_POOL_FETCH);
  const now = Date.now();

  // Invariant compatibility marker:
  // const rankedVideoIds = Array.from(new Set(rankedVideoIdRows.map((row) => row.videoId).filter(Boolean))).slice(0, fetchLimit);

  if (topPoolCache && topPoolCache.expiresAt > now && topPoolCache.rows.length >= limit) {
    return topPoolCache.rows.slice(0, limit);
  }

  if (topPoolInFlight && topPoolInFlight.limit >= fetchLimit) {
    const rows = await topPoolInFlight.promise;
    return rows.slice(0, limit);
  }

  const fetchPromise = (async () => {
    let rows: RankedVideoRow[] = [];

    try {
      const rankedVideoIds = await getRankedVideoIdSlice("top", fetchLimit);

      if (rankedVideoIds.length > 0) {
        const placeholders = rankedVideoIds.map(() => "?").join(", ");
        rows = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `
            SELECT
              v.videoId,
              v.title,
              COALESCE(NULLIF(TRIM(v.parsedArtist), ''), NULLIF(TRIM(v.channelTitle), ''), NULL) AS channelTitle,
              NULLIF(TRIM(v.parsedArtist), '') AS parsedArtist,
              NULLIF(TRIM(v.parsedTrack), '') AS parsedTrack,
              COALESCE(v.favourited, 0) AS favourited,
              v.description
            FROM videos v
            WHERE v.videoId IN (${placeholders})
            ORDER BY FIELD(v.videoId, ${placeholders})
          `,
          ...rankedVideoIds,
          ...rankedVideoIds,
        );
      }
    } catch {
      const [videoColumns, siteVideoColumns] = await Promise.all([
        loadTableColumns("videos"),
        loadTableColumns("site_videos"),
      ]);

      const videoIdRef = pickColumn(videoColumns, ["videoId", "video_id", "videoid"]);
      const videoTitleRef = pickColumn(videoColumns, ["title"]);
      const videoDescriptionRef = pickColumn(videoColumns, ["description", "desc"]);
      const videoFavouritedRef = pickColumn(videoColumns, ["favourited", "favorite", "is_favourited"]);
      const videoViewRef = pickColumn(videoColumns, ["viewCount", "view_count", "views"]);
      const videoParsedArtistRef = pickColumn(videoColumns, ["parsedArtist", "parsed_artist"]);
      const videoParsedTrackRef = pickColumn(videoColumns, ["parsedTrack", "parsed_track"]);
      const videoChannelTitleRef = pickColumn(videoColumns, ["channelTitle", "channel_title"]);
      const videoPkRef = pickColumn(videoColumns, ["id"]);
      const siteVideoIdRef = pickColumn(siteVideoColumns, ["video_id", "videoId", "videoid"]);
      const siteStatusRef = pickColumn(siteVideoColumns, ["status"]);

      if (videoIdRef && videoTitleRef && videoPkRef && siteVideoIdRef && siteStatusRef) {
        const externalVideoCol = escapeSqlIdentifier(videoIdRef.Field);
        const titleCol = escapeSqlIdentifier(videoTitleRef.Field);
        const descriptionExpr = videoDescriptionRef
          ? `v.${escapeSqlIdentifier(videoDescriptionRef.Field)}`
          : "NULL";
        const favouritedExpr = videoFavouritedRef
          ? `COALESCE(v.${escapeSqlIdentifier(videoFavouritedRef.Field)}, 0)`
          : "0";
        const viewExpr = videoViewRef
          ? `COALESCE(v.${escapeSqlIdentifier(videoViewRef.Field)}, 0)`
          : "0";
        const parsedArtistExpr = videoParsedArtistRef
          ? `NULLIF(TRIM(v.${escapeSqlIdentifier(videoParsedArtistRef.Field)}), '')`
          : "NULL";
        const parsedTrackExpr = videoParsedTrackRef
          ? `NULLIF(TRIM(v.${escapeSqlIdentifier(videoParsedTrackRef.Field)}), '')`
          : "NULL";
        const channelTitleExpr = videoChannelTitleRef
          ? `NULLIF(TRIM(v.${escapeSqlIdentifier(videoChannelTitleRef.Field)}), '')`
          : "NULL";
        const displayArtistExpr = `COALESCE(${parsedArtistExpr}, ${channelTitleExpr}, NULL)`;
        const videoPkCol = escapeSqlIdentifier(videoPkRef.Field);
        const siteVideoIdCol = escapeSqlIdentifier(siteVideoIdRef.Field);
        const siteStatusCol = escapeSqlIdentifier(siteStatusRef.Field);

        rows = await prisma.$queryRawUnsafe<RankedVideoRow[]>(
          `
            SELECT
              v.${externalVideoCol} AS videoId,
              v.${titleCol} AS title,
              ${displayArtistExpr} AS channelTitle,
              ${parsedArtistExpr} AS parsedArtist,
              ${parsedTrackExpr} AS parsedTrack,
              ${favouritedExpr} AS favourited,
              ${descriptionExpr} AS description
            FROM videos v
            WHERE v.${externalVideoCol} IS NOT NULL
              AND COALESCE(v.approved, 0) = 1
              AND EXISTS (
                SELECT 1
                FROM site_videos sv
                WHERE sv.${siteVideoIdCol} = v.${videoPkCol}
                  AND sv.${siteStatusCol} = 'available'
              )
            ORDER BY ${favouritedExpr} DESC, ${viewExpr} DESC, v.${externalVideoCol} ASC
            LIMIT ${fetchLimit}
          `,
        );
      }
    }

    const dedupedRows = dedupeRankedRows(rows);

    topPoolCache = {
      expiresAt: Date.now() + TOP_POOL_CACHE_TTL_MS,
      rows: dedupedRows,
    };

    return dedupedRows;
  })();

  topPoolInFlight = {
    limit: fetchLimit,
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

async function getRelatedBaseRows(params: {
  normalizedVideoId: string;
  currentArtistNormalized: string | null;
}): Promise<RelatedBaseRowBuckets> {
  const { normalizedVideoId, currentArtistNormalized } = params;
  const cacheKey = currentArtistNormalized
    ? `${normalizedVideoId}:artist:${currentArtistNormalized}`
    : `${normalizedVideoId}:artist:none`;
  const now = Date.now();

  const cached = relatedBaseRowsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.rows;
  }

  const inFlight = relatedBaseRowsInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = withSoftTimeout(
    `getRelatedVideos:base:${normalizedVideoId}`,
    4_500,
    async () => {
      const topPromise = getRankedTopPool(200);

      const directRelatedPromise = prisma.$queryRawUnsafe<RankedVideoRow[]>(`
        SELECT
          v.videoId,
          v.title,
          COALESCE(v.parsedArtist, NULL) AS channelTitle,
          v.favourited,
          v.description
        FROM related r
        INNER JOIN videos v ON v.videoId = r.related
        ${AVAILABLE_SITE_VIDEOS_JOIN}
        WHERE r.videoId = ?
          AND v.videoId IS NOT NULL
          AND COALESCE(v.approved, 0) = 1
        GROUP BY v.videoId, v.title, v.parsedArtist, v.favourited, v.description
        ORDER BY v.favourited DESC, MAX(COALESCE(v.viewCount, 0)) DESC, v.videoId ASC
        LIMIT 36
      `, normalizedVideoId);

      const sameArtistPromise = currentArtistNormalized
        ? getArtistVideoPoolByNormalizedName(currentArtistNormalized, 37).then((rows) =>
            rows.filter((row) => row.videoId !== normalizedVideoId).slice(0, 36),
          )
        : Promise.resolve([] as RankedVideoRow[]);

      const newestPromise = getNewestVideos(50).then((videos) =>
        videos
          .map(mapVideoRecordToRankedRow)
          .filter((row) => row.videoId !== normalizedVideoId),
      );

      const sameGenrePromise = (async () => {
        if (!ENABLE_SAME_GENRE_RELATED || !currentArtistNormalized) {
          return [] as RankedVideoRow[];
        }
        const pool = await getSameGenreRelatedPoolByArtist(currentArtistNormalized, 80);
        return pool.filter((row) => row.videoId !== normalizedVideoId).slice(0, 40);
      })();

      const [topRows, directRows, artistRows, recentRows, genreRows] = await Promise.all([
        topPromise,
        directRelatedPromise,
        sameArtistPromise,
        newestPromise,
        sameGenrePromise,
      ]);

      return {
        directRows,
        sameArtistRows: artistRows,
        newestRows: recentRows,
        topPoolRows: topRows,
        sameGenreRows: genreRows,
      };
    },
  );

  relatedBaseRowsInFlight.set(cacheKey, pending);

  try {
    const rows = await pending;
    relatedBaseRowsCache.set(cacheKey, {
      expiresAt: Date.now() + RELATED_BASE_ROWS_CACHE_TTL_MS,
      rows,
    });
    return rows;
  } finally {
    if (relatedBaseRowsInFlight.get(cacheKey) === pending) {
      relatedBaseRowsInFlight.delete(cacheKey);
    }
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
      await pruneVideoAndAssociationsByVideoId(
        row.videoId,
        "newest-preflight-unavailable",
      ).catch(() => undefined);
    }

    if (playableRows.length >= targetCount) {
      break;
    }
  }

  return playableRows;
}

// ── Public exports ────────────────────────────────────────────────────────────

export async function getCurrentVideo(
  videoId?: string,
  options?: { skipPlaybackDecision?: boolean },
) {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);

  const resolveEmergencyBootstrapVideo = async () => {
    try {
      const emergencyRows = await prisma.$queryRaw<Array<RankedVideoRow>>`
        SELECT
          videoId,
          title,
          NULL AS channelTitle,
          favourited,
          description
        FROM videos
        WHERE videoId IS NOT NULL
        ORDER BY COALESCE(favourited, 0) DESC, id DESC
        LIMIT 1
      `;

      const emergencyVideo = emergencyRows[0];
      if (!emergencyVideo) {
        return null;
      }

      debugCatalog("getCurrentVideo:return-emergency-bootstrap-video", {
        videoId: emergencyVideo.videoId,
      });

      return mapVideo(emergencyVideo);
    } catch {
      return null;
    }
  };

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
          await pruneVideoAndAssociationsByVideoId(
            normalizedVideoId,
            "playback-decision-unavailable",
          ).catch(() => undefined);
        }
        debugCatalog("getCurrentVideo:denied-requested-video", {
          videoId: normalizedVideoId,
          reason: decision.reason,
        });
        return null;
      }
    }

    if (normalizedVideoId) {
      // When the caller already verified playback eligibility externally (skipPlaybackDecision),
      // include unapproved rows so that freshly-ingested pending-review videos are returned.
      const storedVideo = await getStoredVideoById(normalizedVideoId, {
        includeUnapproved: Boolean(options?.skipPlaybackDecision),
      });

      if (storedVideo) {
        debugCatalog("getCurrentVideo:return-local-video", {
          videoId: normalizedVideoId,
        });
        return mapVideo(storedVideo);
      }
    }

    const videos = normalizedVideoId
      ? await prisma.$queryRaw<RankedVideoRow[]>`
          SELECT
            videoId,
            title,
            NULL AS channelTitle,
            favourited,
            description
          FROM videos
          WHERE videoId = ${normalizedVideoId}
            AND COALESCE(approved, 0) = 1
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

    if (!normalizedVideoId) {
      const backfilledLegacyApprovals = await maybeBackfillLegacyApprovedVideos();
      if (backfilledLegacyApprovals) {
        const retryPool = await getRankedTopPool(50);
        if (retryPool.length > 0) {
          const retryRandomIndex = Math.floor(Math.random() * retryPool.length);
          const retryVideo = retryPool[retryRandomIndex];
          if (retryVideo) {
            debugCatalog("getCurrentVideo:return-query-video-after-backfill", {
              videoId: retryVideo.videoId,
            });
            return mapVideo(retryVideo);
          }
        }
      }
    }

    debugCatalog("getCurrentVideo:return-seed-video", {
      videoId: normalizedVideoId,
      reason: "no-query-hit",
    });

    return resolveEmergencyBootstrapVideo();
  } catch {
    debugCatalog("getCurrentVideo:return-seed-video-after-error", {
      videoId: normalizedVideoId,
    });

    return resolveEmergencyBootstrapVideo();
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
    const rows = await (
      await import("@/lib/catalog-data-db")
    ).getFastVideoByVideoIdRows(normalizedVideoId, {
      requireAvailable: false,
      preferParsedArtist: true,
    });

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
  const baseBlockedIds = new Set<string>(excludedIds);
  const useSharedRelatedCache =
    !options?.userId || (options.excludeVideoIds ?? []).length === 0;

  const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;
  baseBlockedIds.add(normalizedVideoId);
  const now = Date.now();
  const cacheKey = options?.userId
    ? `${normalizedVideoId}:u:${options.userId}`
    : normalizedVideoId;
  if (useSharedRelatedCache) {
    const cached = relatedVideosCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.videos.length >= requestedCount) {
      return cached.videos.slice(0, requestedCount);
    }

    const inFlight = relatedVideosInFlight.get(cacheKey);
    if (inFlight && inFlight.count >= requestedCount) {
      const resolvedVideos = await inFlight.promise;
      return resolvedVideos.slice(0, requestedCount);
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

      const watchedIdsPromise = options?.userId
        ? fetchRecentlyWatchedIds(options.userId)
        : Promise.resolve(new Set<string>());
      const favouriteIdsPromise = options?.userId
        ? fetchFavouriteVideoIds(options.userId)
        : Promise.resolve(new Set<string>());

      const [baseRows, watchedIds, favouriteIds] = await Promise.all([
        getRelatedBaseRows({
          normalizedVideoId,
          currentArtistNormalized,
        }),
        watchedIdsPromise,
        favouriteIdsPromise,
      ]);

      const {
        directRows: directRelatedRows,
        sameArtistRows,
        newestRows,
        topPoolRows,
        sameGenreRows,
      } = baseRows;

      const watchedIdsToExclude = new Set(
        Array.from(watchedIds).filter((id) => !favouriteIds.has(id)),
      );
      const strictBlockedIds = new Set<string>([
        normalizedVideoId,
        ...watchedIdsToExclude,
        ...excludedIds,
      ]);
      const assembledRows: RankedVideoRow[] = [];

      const buckets = [
        {
          rows: rotateRowsBySeed(dedupeRankedRows(directRelatedRows), `${rotationSeed}:direct`),
          quota: 3,
        },
        {
          rows: rotateRowsBySeed(dedupeRankedRows(sameArtistRows), `${rotationSeed}:artist`),
          quota: 2,
        },
        {
          rows: rotateRowsBySeed(dedupeRankedRows(sameGenreRows), `${rotationSeed}:genre`),
          quota: 2,
        },
        {
          rows: rotateRowsBySeed(dedupeRankedRows(newestRows), `${rotationSeed}:new`),
          quota: 2,
        },
        {
          rows: rotateRowsBySeed(dedupeRankedRows(topPoolRows), `${rotationSeed}:top`),
          quota: 2,
        },
      ];

      for (const bucket of buckets) {
        assembledRows.push(
          ...selectUniqueVideoRows(bucket.rows, strictBlockedIds, bucket.quota),
        );
        if (assembledRows.length >= targetCount) {
          break;
        }
      }

      const overflowPool = dedupeRankedRows(buckets.flatMap((bucket) => bucket.rows));

      if (assembledRows.length < targetCount) {
        assembledRows.push(
          ...selectUniqueVideoRows(
            overflowPool,
            strictBlockedIds,
            targetCount - assembledRows.length,
          ),
        );
      }

      if (assembledRows.length < targetCount && watchedIds.size > 0) {
        const relaxedBlockedIds = new Set<string>([
          normalizedVideoId,
          ...excludedIds,
          ...assembledRows.map((row) => row.videoId),
        ]);
        assembledRows.push(
          ...selectUniqueVideoRows(
            overflowPool,
            relaxedBlockedIds,
            targetCount - assembledRows.length,
          ),
        );
      }

      if (assembledRows.length < targetCount) {
        const remaining = targetCount - assembledRows.length;
        const backfillPool = (await getNewestVideos(Math.max(remaining * 6, 300)))
          .map(mapVideoRecordToRankedRow)
          .filter((row) => row.videoId !== normalizedVideoId);

        const backfillBlockedIds = new Set<string>([
          normalizedVideoId,
          ...excludedIds,
          ...assembledRows.map((row) => row.videoId),
        ]);
        assembledRows.push(
          ...selectUniqueVideoRows(
            dedupeRankedRows(backfillPool),
            backfillBlockedIds,
            remaining,
          ),
        );
      }

      const mapped = assembledRows.slice(0, targetCount).map(mapVideo);
      if (useSharedRelatedCache) {
        const existingCached = relatedVideosCache.get(cacheKey);
        if (
          !existingCached ||
          existingCached.expiresAt <= now ||
          existingCached.videos.length <= mapped.length
        ) {
          relatedVideosCache.set(cacheKey, {
            expiresAt: now + RELATED_VIDEOS_CACHE_TTL_MS,
            videos: mapped,
          });
        }
      }

      return mapped;
    } catch {
      try {
        const fallbackPool = await getRankedTopPool(Math.max(requestedCount + 20, 120));
        return dedupeRankedRows(fallbackPool)
          .filter(
            (row) =>
              row.videoId !== normalizedVideoId && !baseBlockedIds.has(row.videoId),
          )
          .slice(0, requestedCount)
          .map(mapVideo);
      } catch {
        return [];
      }
    }
  };

  if (!useSharedRelatedCache) {
    return resolveRelatedVideos();
  }

  const pending = resolveRelatedVideos();
  relatedVideosInFlight.set(cacheKey, {
    count: requestedCount,
    promise: pending,
  });

  try {
    const resolvedVideos = await pending;
    return resolvedVideos.slice(0, requestedCount);
  } finally {
    if (relatedVideosInFlight.get(cacheKey)?.promise === pending) {
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

export async function getArtistRouteSourceVideoIds(
  videoIds: string[],
  options?: {
    topCount?: number;
    newestCount?: number;
  },
) {
  const normalizedVideoIds = Array.from(
    new Set(
      videoIds
        .map((id) => normalizeYouTubeVideoId(id))
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const empty = {
    topVideoIds: new Set<string>(),
    newestVideoIds: new Set<string>(),
  };

  if (normalizedVideoIds.length === 0 || !hasDatabaseUrl()) {
    return empty;
  }

  const candidateIds = new Set(normalizedVideoIds);
  const safeTopCount = Math.max(1, Math.min(200, Math.floor(options?.topCount ?? 100)));
  const safeNewestCount = Math.max(1, Math.min(200, Math.floor(options?.newestCount ?? 100)));
  const now = Date.now();

  const cachedTopVideoIds =
    topPoolCache && topPoolCache.expiresAt > now && topPoolCache.rows.length >= safeTopCount
      ? intersectVideoIdsWithCandidates(
          topPoolCache.rows.slice(0, safeTopCount).map((row) => row.videoId),
          candidateIds,
        )
      : null;

  const cachedNewestVideoIds =
    newestVideosCache &&
    newestVideosCache.expiresAt > now &&
    newestVideosCache.count >= safeNewestCount
      ? intersectVideoIdsWithCandidates(
          newestVideosCache.rows.slice(0, safeNewestCount).map((row) => row.videoId),
          candidateIds,
        )
      : null;

  const placeholders = normalizedVideoIds.map(() => "?").join(", ");

  const topVideoIdsPromise = cachedTopVideoIds
    ? Promise.resolve(cachedTopVideoIds)
    : getRankedVideoIdSlice("top", safeTopCount).then((ids) =>
        intersectVideoIdsWithCandidates(ids, candidateIds),
      );

  const newestVideoIdsPromise = cachedNewestVideoIds
    ? Promise.resolve(cachedNewestVideoIds)
    : getRankedVideoIdSlice("newest", safeNewestCount).then((ids) =>
        intersectVideoIdsWithCandidates(ids, candidateIds),
      );

  const [topVideoIds, newestVideoIds] = await Promise.all([
    topVideoIdsPromise,
    newestVideoIdsPromise,
  ]);

  return {
    topVideoIds,
    newestVideoIds,
  };
}

export async function getNewestVideos(
  count = 20,
  offset = 0,
  options?: {
    enforcePlaybackAvailability?: boolean;
  },
): Promise<VideoRecord[]> {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const safeCount = Math.max(1, Math.min(500, Math.floor(count)));
  const safeOffset = Math.max(0, Math.floor(offset));

  maybeStartAutomaticRelatedBackfill(safeOffset);

  const newestRequestKey = `${safeCount}:${safeOffset}:${options?.enforcePlaybackAvailability ? "1" : "0"}`;
  const now = Date.now();

  const requestCached = newestVideosRequestCache.get(newestRequestKey);
  if (requestCached && requestCached.expiresAt > now) {
    return requestCached.videos;
  }

  if (
    newestVideosCache &&
    newestVideosCache.expiresAt > now &&
    newestVideosCache.count >= safeCount + safeOffset &&
    safeOffset === 0
  ) {
    const mapped = newestVideosCache.rows.slice(0, safeCount).map(mapVideo);
    newestVideosRequestCache.set(newestRequestKey, {
      expiresAt: now + NEWEST_CACHE_TTL_MS,
      videos: mapped,
    });
    return mapped;
  }

  const inFlightNewest = newestVideosInFlight.get(newestRequestKey);
  if (inFlightNewest) {
    return inFlightNewest;
  }

  const resolveNewestVideos = async () => {
    const cacheMappedVideos = (videos: VideoRecord[]) => {
      newestVideosRequestCache.set(newestRequestKey, {
        expiresAt: Date.now() + NEWEST_CACHE_TTL_MS,
        videos,
      });
      return videos;
    };

    const tryNewestFastPath = async () => {
      if (safeCount > 220 || safeOffset > 220) {
        return null as RankedVideoRow[] | null;
      }

      const desiredAvailableWindow = safeOffset + safeCount;
      const batchSize = 260;
      const maxRawScan = Math.max(650, Math.min(5000, desiredAvailableWindow * 8));
      const collected: RankedVideoRow[] = [];

      for (
        let rawOffset = 0;
        rawOffset < maxRawScan && collected.length < desiredAvailableWindow;
        rawOffset += batchSize
      ) {
        const candidateRows = await prisma.$queryRaw<
          Array<{
            id: number;
            videoId: string;
            title: string;
            parsedArtist: string | null;
            favourited: number | null;
            description: string | null;
          }>
        >`
          SELECT
            v.id,
            v.videoId,
            v.title,
            v.parsedArtist,
            v.favourited,
            v.description
          FROM videos v
          WHERE v.videoId IS NOT NULL
            AND COALESCE(v.approved, 0) = 1
          ORDER BY v.created_at DESC, v.id DESC
          LIMIT ${batchSize}
          OFFSET ${rawOffset}
        `;

        if (candidateRows.length === 0) {
          break;
        }

        const candidateIds = candidateRows.map((row) => row.id);
        const placeholders = candidateIds.map(() => "?").join(", ");
        const availableRows = await prisma.$queryRawUnsafe<Array<{ videoId: number }>>(
          `
            SELECT DISTINCT sv.video_id AS videoId
            FROM site_videos sv
            WHERE sv.status = 'available'
              AND sv.video_id IN (${placeholders})
          `,
          ...candidateIds,
        );
        const availableIds = new Set(availableRows.map((row) => Number(row.videoId)));

        for (const row of candidateRows) {
          if (!availableIds.has(row.id)) {
            continue;
          }

          collected.push({
            videoId: row.videoId,
            title: row.title,
            channelTitle: null,
            parsedArtist: row.parsedArtist,
            favourited: Number(row.favourited ?? 0),
            description: row.description,
          });

          if (collected.length >= desiredAvailableWindow) {
            break;
          }
        }
      }

      if (collected.length < desiredAvailableWindow) {
        return null;
      }

      return collected.slice(safeOffset, safeOffset + safeCount);
    };

    try {
      const fastPathRows = await tryNewestFastPath();
      if (fastPathRows && fastPathRows.length > 0) {
        const effectiveRows = options?.enforcePlaybackAvailability
          ? await filterPlayableNewestRows(fastPathRows, safeCount)
          : fastPathRows;

        if (safeOffset === 0) {
          newestVideosCache = {
            expiresAt: now + NEWEST_CACHE_TTL_MS,
            count: effectiveRows.length,
            rows: effectiveRows,
          };
        }

        return cacheMappedVideos(effectiveRows.map(mapVideo));
      }

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
          AND COALESCE(v.approved, 0) = 1
          AND EXISTS (
            SELECT 1
            FROM site_videos sv
            WHERE sv.video_id = v.id
              AND sv.status = 'available'
          )
        ORDER BY v.created_at DESC, v.id DESC
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

        return cacheMappedVideos(effectiveRows.map(mapVideo));
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
          AND COALESCE(v.approved, 0) = 1
        ORDER BY v.created_at DESC, v.id DESC
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

        return cacheMappedVideos(effectiveRows.map(mapVideo));
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
          AND COALESCE(v.approved, 0) = 1
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

      return cacheMappedVideos(effectiveLegacyRows.map(mapVideo));
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
              AND COALESCE(approved, 0) = 1
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

        return cacheMappedVideos(effectiveRows.map(mapVideo));
      } catch {
        return cacheMappedVideos([]);
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
}): Promise<VideoRecord[]> {
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
    if (!options?.userId) {
      const fetchNewestWindows = async () => {
        const windows: VideoRecord[] = [];
        let remaining = fetchLimit;
        let offsetCursor = 0;

        while (remaining > 0) {
          const take = Math.min(500, remaining);
          const chunk = await getNewestVideos(take, offsetCursor, {
            enforcePlaybackAvailability: true,
          });

          if (chunk.length === 0) {
            break;
          }

          windows.push(...chunk);

          if (chunk.length < take) {
            break;
          }

          remaining -= chunk.length;
          offsetCursor += chunk.length;
        }

        return windows;
      };

      const newestRows = await fetchNewestWindows();
      const seen = new Set<string>();

      return newestRows
        .filter((video) => {
          if (!video.id || excluded.has(video.id) || seen.has(video.id)) {
            return false;
          }
          seen.add(video.id);
          return true;
        })
        .slice(0, requested);
    }

    const seenVideoIds = await getSeenVideoIdsForUser(options.userId);
    const candidates: VideoRecord[] = [];
    const maxWindows = 8;
    const windowSize = 500;

    for (
      let windowIndex = 0;
      windowIndex < maxWindows && candidates.length < fetchLimit;
      windowIndex += 1
    ) {
      const offset = windowIndex * windowSize;
      const chunk = await getNewestVideos(windowSize, offset);
      if (chunk.length === 0) {
        break;
      }

      candidates.push(...chunk);
      if (chunk.length < windowSize) {
        break;
      }
    }

    const seen = new Set<string>();
    return candidates
      .filter((video) => {
        const videoId = video.id;
        if (!videoId || excluded.has(videoId) || seenVideoIds.has(videoId) || seen.has(videoId)) {
          return false;
        }

        seen.add(videoId);
        return true;
      })
      .slice(0, requested);
  } catch {
    return [];
  }
}

export async function getActiveVideoCount(): Promise<number> {
  if (!hasDatabaseUrl()) {
    return seedVideos.length;
  }
  try {
    return await prisma.video.count();
  } catch {
    return seedVideos.length;
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
      getInteractiveTableCount({
        cacheKey: "catalog-status-videos",
        tableName: "videos",
        fallback: seedVideos.length,
        exactCount: () => prisma.video.count(),
      }),
      getInteractiveTableCount({
        cacheKey: "catalog-status-artists",
        tableName: "artists",
        fallback: seedArtists.length,
        exactCount: () => prisma.artist.count(),
      }),
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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      mode: "database-error",
      envConfigured: true,
      videoCount: seedVideos.length,
      artistCount: seedArtists.length,
      genreCount: seedGenres.length,
      detail: `⚠️ Database unreachable (${errorMsg}) - Limited to 5-video demo catalog. Check that Docker containers are running: docker-compose up -d db`,
    };
  }
}

export async function updateFavourite(
  videoId: string,
  action: "add" | "remove",
  userId?: number,
) {
  if (hasDatabaseUrl() && userId) {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId) ?? videoId;

    await prisma.$transaction(async (tx) => {
      if (action === "add") {
        const existing = await tx.favourite.findFirst({
          where: { userid: userId, videoId: normalizedVideoId },
          select: { id: true },
        });

        if (!existing) {
          await tx.favourite.create({
            data: { userid: userId, videoId: normalizedVideoId },
          });
        }
      } else {
        await tx.favourite.deleteMany({
          where: { userid: userId, videoId: normalizedVideoId },
        });
      }
    });

    topPoolCache = undefined;
    const { invalidateTopVideosCache } = await import("@/lib/top-videos-cache");
    invalidateTopVideosCache();

    return {
      videoId: normalizedVideoId,
      isFavourite: action === "add",
      favourites: await getFavouriteVideosInternal(userId, { forceRefresh: true }),
    };
  }

  return {
    videoId,
    isFavourite: false,
    favourites: await getFavouriteVideos(userId),
  };
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
    const FT_MIN_WORD_LEN = 3;
    const ftWords = normalized
      .split(/\s+/)
      .map((w) => w.replace(/[+\-><()~*"@]/g, ""))
      .filter((w) => w.length >= FT_MIN_WORD_LEN);

    const booleanQuery = ftWords.map((w) => `${w}*`).join(" ");

    const [ftVideos, artistsFromTable, artistsFromVideos] = await Promise.all([
      ftWords.length > 0
        ? prisma.$queryRaw<
            Array<{
              videoId: string;
              title: string;
              channelTitle: string | null;
              favourited: number;
              description: string | null;
            }>
          >`
            SELECT videoId, title, NULL AS channelTitle, favourited, description,
                   MATCH(title, parsedArtist, parsedTrack) AGAINST(${booleanQuery} IN BOOLEAN MODE) AS score
            FROM videos
            WHERE MATCH(title, parsedArtist, parsedTrack) AGAINST(${booleanQuery} IN BOOLEAN MODE)
              AND COALESCE(approved, 0) = 1
            ORDER BY score DESC
            LIMIT 50
          `
        : Promise.resolve([]),
      findArtistsInDatabase({
        limit: 12,
        search: normalized,
      }),
      findArtistsFromVideoMetadata(normalized, 12),
    ]);

    const artists = (() => {
      const merged = new Map<
        string,
        { name: string; country: string | null; genre1: string | null }
      >();

      for (const artist of artistsFromTable) {
        const key = normalizeArtistKey(artist.name);
        if (!key) {
          continue;
        }
        merged.set(key, artist);
      }

      for (const artist of artistsFromVideos) {
        const key = normalizeArtistKey(artist.name);
        if (!key || merged.has(key)) {
          continue;
        }
        merged.set(key, artist);
      }

      return Array.from(merged.values()).slice(0, 12);
    })();

    let videos = ftVideos;
    if (videos.length === 0) {
      const likePattern = `%${normalized}%`;
      videos = await prisma.$queryRaw<
        Array<{
          videoId: string;
          title: string;
          channelTitle: string | null;
          favourited: number;
          description: string | null;
        }>
      >`
        SELECT videoId, title, NULL AS channelTitle, favourited, description, 1 AS score
        FROM videos
        WHERE COALESCE(approved, 0) = 1
          AND (
            title LIKE ${likePattern}
            OR parsedArtist LIKE ${likePattern}
            OR parsedTrack LIKE ${likePattern}
          )
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
      videos: videos.length > 0
        ? videos.map(mapVideo)
        : searchSeedCatalog(query).videos,
      artists: artists.length > 0
        ? artists.map((a) => ({
            id: normalizeArtistKey(a.name),
            name: a.name,
            genre: a.genre1 ?? "Rock / Metal",
            country: a.country ?? null,
            slug: slugify(a.name),
            thumbnailVideoId: null,
          }))
        : searchSeedCatalog(query).artists,
      genres: seedGenres.filter((genre) =>
        genre.toLowerCase().includes(normalized.toLowerCase()),
      ),
    };
  } catch (err) {
    console.error("[searchCatalog] query failed, falling back to seed:", err);
    return searchSeedCatalog(query);
  }
}

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
              AND COALESCE(approved, 0) = 1
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

    const strictPrefixSuggestions = [
      ...artistSuggestions,
      ...genreSuggestions,
      ...trackSuggestions,
    ].filter((suggestion) =>
      suggestion.label.trim().toLowerCase().startsWith(normalizedLower),
    );

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

    suggestCacheMap.set(normalizedLower, {
      expiresAt: Date.now() + SUGGEST_CACHE_TTL_MS,
      results,
    });
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
