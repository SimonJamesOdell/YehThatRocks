import { prisma } from "@/lib/db";
import { getAvailableVideoMaxId } from "@/lib/available-video-max-id";

export const RANDOM_CATALOG_POOL_SIZE = 2_000;
export const RANDOM_CATALOG_POOL_TTL_MS = 5 * 60_000;

const PROBE_COUNT = 8;
const PROBE_LIMIT = 350;

let _randomCatalogPool: readonly string[] | null = null;
let _randomCatalogPoolExpiresAt = 0;
let _randomCatalogPoolInFlight: Promise<readonly string[]> | null = null;

export function resetRandomCatalogPool(): void {
  _randomCatalogPool = null;
  _randomCatalogPoolExpiresAt = 0;
  _randomCatalogPoolInFlight = null;
}

async function buildRandomCatalogPool(): Promise<readonly string[]> {
  const maxId = await getAvailableVideoMaxId();
  if (!maxId || maxId <= 0) {
    return [];
  }

  const bandSize = Math.floor(maxId / PROBE_COUNT);

  // One random start per band so probes cover the full ID range, not just one region.
  const probeStarts = Array.from({ length: PROBE_COUNT }, (_, i) => {
    const bandStart = i * bandSize + 1;
    const bandEnd = (i + 1) * bandSize;
    return Math.max(1, bandStart + Math.floor(Math.random() * Math.max(1, bandEnd - bandStart)));
  });

  const probeSql = `
    SELECT v.videoId
    FROM videos v
    WHERE v.videoId IS NOT NULL
      AND v.id >= ?
      AND EXISTS (
        SELECT 1
        FROM site_videos sv
        WHERE sv.video_id = v.id
          AND sv.status = 'available'
      )
    ORDER BY v.id ASC
    LIMIT ?
  `;

  const chunks = await Promise.all(
    probeStarts.map((start) =>
      prisma.$queryRawUnsafe<Array<{ videoId: string }>>(probeSql, start, PROBE_LIMIT),
    ),
  );

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const chunk of chunks) {
    for (const row of chunk) {
      if (row.videoId && !seen.has(row.videoId)) {
        seen.add(row.videoId);
        ids.push(row.videoId);
      }
    }
  }

  // Fisher-Yates shuffle so callers get a uniformly random ordering.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ids[i];
    ids[i] = ids[j]!;
    ids[j] = tmp!;
  }

  return ids.slice(0, RANDOM_CATALOG_POOL_SIZE);
}

export async function getRandomCatalogPool(): Promise<readonly string[]> {
  const now = Date.now();

  if (_randomCatalogPool !== null && _randomCatalogPoolExpiresAt > now) {
    return _randomCatalogPool;
  }

  if (_randomCatalogPoolInFlight !== null) {
    return _randomCatalogPoolInFlight;
  }

  _randomCatalogPoolInFlight = buildRandomCatalogPool()
    .then((ids) => {
      _randomCatalogPool = ids;
      _randomCatalogPoolExpiresAt = Date.now() + RANDOM_CATALOG_POOL_TTL_MS;
      return ids;
    })
    .finally(() => {
      _randomCatalogPoolInFlight = null;
    });

  return _randomCatalogPoolInFlight;
}
