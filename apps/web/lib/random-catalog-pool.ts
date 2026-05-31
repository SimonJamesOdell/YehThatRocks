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

  // One random start per bounded band so each probe stays index-local even in sparse ID ranges.
  const probeBands = Array.from({ length: PROBE_COUNT }, (_, i) => {
    const bandStart = i * bandSize + 1;
    const rawBandEnd = (i + 1) * bandSize;
    const bandEnd = i === PROBE_COUNT - 1 ? maxId : Math.min(maxId, rawBandEnd);
    const randomStart = Math.max(1, bandStart + Math.floor(Math.random() * Math.max(1, bandEnd - bandStart + 1)));

    return {
      bandStart,
      bandEnd,
      randomStart,
    };
  });

  const probeSql = `
    SELECT v.videoId
    FROM site_videos sv FORCE INDEX (idx_site_videos_status_video_id)
    INNER JOIN videos v ON v.id = sv.video_id
    WHERE sv.status = 'available'
      AND sv.video_id >= ?
      AND sv.video_id <= ?
      AND v.videoId IS NOT NULL
    ORDER BY sv.video_id ASC
    LIMIT ?
  `;

  const chunks = await Promise.all(probeBands.map(async (band) => {
    const primary = await prisma.$queryRawUnsafe<Array<{ videoId: string }>>(
      probeSql,
      band.randomStart,
      band.bandEnd,
      PROBE_LIMIT,
    );

    if (primary.length >= PROBE_LIMIT || band.randomStart <= band.bandStart) {
      return primary;
    }

    const remainder = PROBE_LIMIT - primary.length;
    const wrap = await prisma.$queryRawUnsafe<Array<{ videoId: string }>>(
      probeSql,
      band.bandStart,
      band.randomStart - 1,
      remainder,
    );

    return [...primary, ...wrap];
  }));

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
