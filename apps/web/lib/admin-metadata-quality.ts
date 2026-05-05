import { prisma } from "@/lib/db";

function toNumber(value: bigint | number | string | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }

  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Metadata quality stats are slow-changing (require full videos table scan across
// multiple workers). 15-minute TTL reduces per-worker query frequency by 3× vs the
// previous 5-minute value.
export const METADATA_QUALITY_CACHE_TTL_MS = 15 * 60 * 1000;

export type MetadataQualityStats = {
  expiresAt: number;
  availableVideos: number;
  checkFailedEntries: number;
  missingMetadata: number;
  lowConfidence: number;
  unknownType: number;
};

let metadataQualityCache: MetadataQualityStats | null = null;
let metadataQualityCachePromise: Promise<MetadataQualityStats> | null = null;

/**
 * Returns metadata quality stats, using an in-memory cache with a 15-minute TTL.
 * Concurrent callers share a single in-flight DB request (promise coalescing).
 */
export async function getMetadataQualityStats(): Promise<MetadataQualityStats> {
  const cached = metadataQualityCache;

  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  if (!metadataQualityCachePromise) {
    metadataQualityCachePromise = (async () => {
      // Two focused single-table queries run in parallel:
      // - site_videos  → status counts  (uses (status, video_id) index)
      // - videos       → metadata quality aggregates (full-scan, cached long)
      const [statusCounts, metaCounts] = await Promise.all([
        prisma.$queryRaw<Array<{
          availableVideos: bigint | number;
          checkFailedEntries: bigint | number;
        }>>`
          SELECT
            SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS availableVideos,
            SUM(CASE WHEN status = 'check-failed' THEN 1 ELSE 0 END) AS checkFailedEntries
          FROM site_videos
        `.catch(() => []),
        prisma.$queryRaw<Array<{
          missingMetadata: bigint | number;
          lowConfidence: bigint | number;
          unknownType: bigint | number;
        }>>`
          SELECT
            SUM(CASE WHEN parsedArtist IS NULL OR TRIM(parsedArtist) = '' OR parsedTrack IS NULL OR TRIM(parsedTrack) = '' THEN 1 ELSE 0 END) AS missingMetadata,
            SUM(CASE WHEN parseConfidence IS NULL OR parseConfidence < 0.80 THEN 1 ELSE 0 END) AS lowConfidence,
            SUM(CASE WHEN parsedVideoType IS NULL OR parsedVideoType = '' OR parsedVideoType = 'unknown' THEN 1 ELSE 0 END) AS unknownType
          FROM videos
        `.catch(() => []),
      ]);

      const result: MetadataQualityStats = {
        expiresAt: Date.now() + METADATA_QUALITY_CACHE_TTL_MS,
        availableVideos: toNumber(statusCounts[0]?.availableVideos),
        checkFailedEntries: toNumber(statusCounts[0]?.checkFailedEntries),
        missingMetadata: toNumber(metaCounts[0]?.missingMetadata),
        lowConfidence: toNumber(metaCounts[0]?.lowConfidence),
        unknownType: toNumber(metaCounts[0]?.unknownType),
      };

      metadataQualityCache = result;
      return result;
    })().finally(() => {
      metadataQualityCachePromise = null;
    });
  }

  return metadataQualityCachePromise;
}

/** Clears the in-memory cache and any in-flight promise. Used in tests. */
export function resetMetadataQualityCache(): void {
  metadataQualityCache = null;
  metadataQualityCachePromise = null;
}
