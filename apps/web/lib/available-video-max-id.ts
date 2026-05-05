import { prisma } from "@/lib/db";

const MAX_ID_CACHE_TTL_MS = Math.max(15_000, Math.min(60_000, Number(process.env.AVAILABLE_VIDEO_MAX_ID_CACHE_TTL_MS || "30000")));
const MAX_ID_VERIFY_INTERVAL_MS = Math.max(60_000, Math.min(15 * 60_000, Number(process.env.AVAILABLE_VIDEO_MAX_ID_VERIFY_INTERVAL_MS || "300000")));

type MaxIdStateRow = {
  maxAvailableVideoId: bigint | number;
  dirty: bigint | number;
  verifiedAt: Date | null;
};

let ensureTablePromise: Promise<void> | null = null;
let tableEnsured = false;
let maxIdCache: { expiresAt: number; maxId: number } | null = null;
let maxIdInFlight: Promise<number> | null = null;

async function ensureMaxIdStateTable() {
  if (tableEnsured) {
    return;
  }

  if (!ensureTablePromise) {
    ensureTablePromise = prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS available_video_max_id_state (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
        max_available_video_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        dirty TINYINT(1) NOT NULL DEFAULT 1,
        verified_at DATETIME(3) NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      )
    `)
      .then(() => {
        tableEnsured = true;
      })
      .finally(() => {
        ensureTablePromise = null;
      });
  }

  await ensureTablePromise;
}

function normalizeMaxId(value: bigint | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function shouldVerifyState(row: MaxIdStateRow | null, nowMs: number, forceVerify: boolean) {
  if (!row) return true;
  if (forceVerify) return true;

  const dirty = Number(row.dirty ?? 0);
  if (dirty > 0) return true;

  if (!(row.verifiedAt instanceof Date)) return true;

  return nowMs - row.verifiedAt.getTime() >= MAX_ID_VERIFY_INTERVAL_MS;
}

async function readStateRow(): Promise<MaxIdStateRow | null> {
  const rows = await prisma.$queryRaw<MaxIdStateRow[]>`
    SELECT
      max_available_video_id AS maxAvailableVideoId,
      dirty AS dirty,
      verified_at AS verifiedAt
    FROM available_video_max_id_state
    WHERE id = 1
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function computeAndPersistAuthoritativeMaxId() {
  // Query from site_videos using the (status, video_id) composite index so MySQL
  // can do a single backward index seek rather than scanning all 7M+ videos rows
  // with a correlated EXISTS subquery. MAX(sv.video_id) equals MAX(v.id WHERE available)
  // because site_videos.video_id is a FK to videos.id.
  const rows = await prisma.$queryRaw<Array<{ maxId: bigint | number | null }>>`
    SELECT MAX(sv.video_id) AS maxId
    FROM site_videos sv
    WHERE sv.status = 'available'
      AND sv.video_id IS NOT NULL
  `;

  const maxId = normalizeMaxId(rows[0]?.maxId ?? 0);
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO available_video_max_id_state (
      id,
      max_available_video_id,
      dirty,
      verified_at,
      updated_at
    ) VALUES (
      ${1},
      ${maxId},
      ${0},
      ${now},
      ${now}
    )
    ON DUPLICATE KEY UPDATE
      max_available_video_id = VALUES(max_available_video_id),
      dirty = 0,
      verified_at = VALUES(verified_at),
      updated_at = VALUES(updated_at)
  `;

  maxIdCache = {
    expiresAt: Date.now() + MAX_ID_CACHE_TTL_MS,
    maxId,
  };

  return maxId;
}

export function resetAvailableVideoMaxIdRuntimeCache() {
  maxIdCache = null;
  maxIdInFlight = null;
}

export async function getAvailableVideoMaxId(options?: { forceVerify?: boolean }) {
  await ensureMaxIdStateTable();

  const forceVerify = Boolean(options?.forceVerify);
  const nowMs = Date.now();

  if (!forceVerify && maxIdCache && maxIdCache.expiresAt > nowMs) {
    return maxIdCache.maxId;
  }

  if (maxIdInFlight) {
    return maxIdInFlight;
  }

  maxIdInFlight = (async () => {
    const stateRow = await readStateRow().catch(() => null);
    const needsVerify = shouldVerifyState(stateRow, Date.now(), forceVerify);

    if (!needsVerify && stateRow) {
      const maxId = normalizeMaxId(stateRow.maxAvailableVideoId);
      maxIdCache = {
        expiresAt: Date.now() + MAX_ID_CACHE_TTL_MS,
        maxId,
      };
      return maxId;
    }

    return computeAndPersistAuthoritativeMaxId();
  })().finally(() => {
    maxIdInFlight = null;
  });

  return maxIdInFlight;
}

export async function recordAvailableVideoIdCandidate(videoRowId: number) {
  const safeRowId = Math.max(0, Math.floor(Number(videoRowId)));
  if (!Number.isFinite(safeRowId) || safeRowId <= 0) {
    return;
  }

  await ensureMaxIdStateTable();

  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO available_video_max_id_state (
      id,
      max_available_video_id,
      dirty,
      verified_at,
      updated_at
    ) VALUES (
      ${1},
      ${safeRowId},
      ${0},
      ${now},
      ${now}
    )
    ON DUPLICATE KEY UPDATE
      max_available_video_id = GREATEST(max_available_video_id, VALUES(max_available_video_id)),
      updated_at = VALUES(updated_at)
  `;

  if (!maxIdCache || safeRowId > maxIdCache.maxId) {
    maxIdCache = {
      expiresAt: Date.now() + MAX_ID_CACHE_TTL_MS,
      maxId: safeRowId,
    };
  }
}

export async function markAvailableVideoMaxIdDirty() {
  await ensureMaxIdStateTable();

  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO available_video_max_id_state (
      id,
      max_available_video_id,
      dirty,
      verified_at,
      updated_at
    ) VALUES (
      ${1},
      ${0},
      ${1},
      ${null},
      ${now}
    )
    ON DUPLICATE KEY UPDATE
      dirty = 1,
      updated_at = VALUES(updated_at)
  `;

  maxIdCache = null;
}
