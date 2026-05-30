import { prisma } from "@/lib/db";
import {
  getCachedCategoryArtistsByGenre,
  getCategoryArtistTabCountsByGenre,
  getCategoryArtistsByGenre,
  getGenreCards,
  getRuntimeCachedTopLevelGenreCards,
  warmCategoryArtistRuntimeCacheByGenre,
} from "@/lib/catalog-data-genres";
import { getGenreSlug, hasDatabaseUrl, type CategoryArtistCard, type GenreCard } from "@/lib/catalog-data-utils";
import { TOP_LEVEL_GENRE_BUCKETS } from "@/lib/genre-buckets";

const SNAPSHOT_NAME = "categories_new";
const SNAPSHOT_TOP_LEVEL_KEY = "top-level";
const SNAPSHOT_ARTIST_LIMIT = 25_000;
const CATEGORIES_NEW_SNAPSHOT_BUILD_DEBOUNCE_MS = 5_000;

export type CategoriesNewTopLevelCard = GenreCard & {
  slug: string;
};

export type CategoriesNewTopLevelSnapshot = {
  buildVersion: number;
  generatedAt: string;
  cards: CategoriesNewTopLevelCard[];
};

export type CategoriesNewCategorySnapshot = {
  buildVersion: number;
  generatedAt: string;
  slug: string;
  genre: string;
  totalArtists: number;
  tabCounts: Record<string, number>;
  artists: CategoryArtistCard[];
};

let categoriesNewSnapshotBuildInFlight: Promise<number | null> | null = null;
let categoriesNewSnapshotBuildQueued = false;
let categoriesNewSnapshotBuildDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let categoriesNewSnapshotBuildPendingReason = "catalog-change";

function getCategorySnapshotKey(slug: string) {
  return `category:${slug.trim().toLowerCase()}`;
}

async function ensureCategoriesNewSnapshotTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS category_page_snapshots (
      snapshot_name VARCHAR(64) NOT NULL,
      build_version BIGINT NOT NULL,
      page_key VARCHAR(255) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (snapshot_name, build_version, page_key),
      KEY idx_category_page_snapshots_lookup (snapshot_name, page_key, build_version),
      KEY idx_category_page_snapshots_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS category_page_snapshot_state (
      snapshot_name VARCHAR(64) NOT NULL,
      active_build_version BIGINT NULL,
      build_status VARCHAR(32) NOT NULL DEFAULT 'idle',
      last_started_at DATETIME(3) NULL,
      last_finished_at DATETIME(3) NULL,
      last_error TEXT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (snapshot_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function updateCategoriesNewSnapshotState(args: {
  buildStatus: "idle" | "running" | "ready" | "failed";
  activeBuildVersion?: number | null;
  lastError?: string | null;
  touchStartedAt?: boolean;
  touchFinishedAt?: boolean;
}) {
  await ensureCategoriesNewSnapshotTables();

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO category_page_snapshot_state (
        snapshot_name,
        active_build_version,
        build_status,
        last_started_at,
        last_finished_at,
        last_error
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        active_build_version = VALUES(active_build_version),
        build_status = VALUES(build_status),
        last_started_at = VALUES(last_started_at),
        last_finished_at = VALUES(last_finished_at),
        last_error = VALUES(last_error),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    SNAPSHOT_NAME,
    args.activeBuildVersion ?? null,
    args.buildStatus,
    args.touchStartedAt ? new Date() : null,
    args.touchFinishedAt ? new Date() : null,
    args.lastError ?? null,
  );
}

async function getActiveCategoriesNewBuildVersion() {
  if (!hasDatabaseUrl()) {
    return null;
  }

  await ensureCategoriesNewSnapshotTables();

  const rows = await prisma.$queryRawUnsafe<Array<{ activeBuildVersion: bigint | number | null }>>(
    `
      SELECT active_build_version AS activeBuildVersion
      FROM category_page_snapshot_state
      WHERE snapshot_name = ?
      LIMIT 1
    `,
    SNAPSHOT_NAME,
  ).catch(() => []);

  const value = rows[0]?.activeBuildVersion;
  return value === null || value === undefined ? null : Number(value);
}

async function writeCategoriesNewSnapshot(buildVersion: number, pageKey: string, payload: unknown) {
  await ensureCategoriesNewSnapshotTables();

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO category_page_snapshots (snapshot_name, build_version, page_key, payload_json)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        payload_json = VALUES(payload_json),
        updated_at = CURRENT_TIMESTAMP(3)
    `,
    SNAPSHOT_NAME,
    buildVersion,
    pageKey,
    JSON.stringify(payload),
  );
}

async function cleanupOldCategoriesNewSnapshots(activeBuildVersion: number) {
  await prisma.$executeRawUnsafe(
    `
      DELETE FROM category_page_snapshots
      WHERE snapshot_name = ?
        AND build_version <> ?
    `,
    SNAPSHOT_NAME,
    activeBuildVersion,
  ).catch(() => undefined);
}

async function readCategoriesNewSnapshot<T>(pageKey: string, awaitInFlightIfMissing = false): Promise<T | null> {
  if (!hasDatabaseUrl()) {
    return null;
  }

  let activeBuildVersion = await getActiveCategoriesNewBuildVersion();

  if (!activeBuildVersion && awaitInFlightIfMissing && categoriesNewSnapshotBuildInFlight) {
    await categoriesNewSnapshotBuildInFlight.catch(() => undefined);
    activeBuildVersion = await getActiveCategoriesNewBuildVersion();
  }

  if (!activeBuildVersion) {
    return null;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ payloadJson: string }>>(
    `
      SELECT payload_json AS payloadJson
      FROM category_page_snapshots
      WHERE snapshot_name = ?
        AND build_version = ?
        AND page_key = ?
      LIMIT 1
    `,
    SNAPSHOT_NAME,
    activeBuildVersion,
    pageKey,
  ).catch(() => []);

  const payloadJson = rows[0]?.payloadJson;
  if (!payloadJson) {
    return null;
  }

  try {
    return JSON.parse(payloadJson) as T;
  } catch {
    return null;
  }
}

function normalizeTopLevelCards(cards: GenreCard[]): CategoriesNewTopLevelCard[] {
  return TOP_LEVEL_GENRE_BUCKETS.map((bucket) => {
    const matched = cards.find((card) => card.genre.trim().toLowerCase() === bucket.label.trim().toLowerCase());
    return {
      genre: bucket.label,
      slug: getGenreSlug(bucket.label),
      previewVideoId: matched?.previewVideoId ?? null,
      artistCount: Math.max(0, Number(matched?.artistCount ?? 0)),
    };
  });
}

async function buildCategoriesNewSnapshotRows(buildVersion: number) {
  const generatedAt = new Date().toISOString();
  const runtimeCards = await getRuntimeCachedTopLevelGenreCards().catch(() => null);
  const topLevelCards = normalizeTopLevelCards(
    runtimeCards && runtimeCards.length > 0
      ? runtimeCards
      : await getGenreCards().catch(() => []),
  );

  const topLevelPayload: CategoriesNewTopLevelSnapshot = {
    buildVersion,
    generatedAt,
    cards: topLevelCards,
  };
  await writeCategoriesNewSnapshot(buildVersion, SNAPSHOT_TOP_LEVEL_KEY, topLevelPayload);

  for (const card of topLevelCards) {
    const genre = card.genre;
    const slug = card.slug;

    await warmCategoryArtistRuntimeCacheByGenre(genre).catch(() => undefined);

    const tabCounts = await getCategoryArtistTabCountsByGenre(genre).catch(() => ({ all: 0 }));

    let artists = await getCategoryArtistsByGenre(genre, {
      offset: 0,
      limit: SNAPSHOT_ARTIST_LIMIT,
      maxLimit: SNAPSHOT_ARTIST_LIMIT,
      bypassRuntimeCache: true,
    }).catch(() => []);

    // Runtime cache rows can be stale/partial for some large buckets; prefer a complete snapshot payload.
    const expectedTotalArtists = Math.max(0, Number(tabCounts.all ?? 0));
    if (artists.length < expectedTotalArtists) {
      const cachedArtists = await getCachedCategoryArtistsByGenre(genre, {
        offset: 0,
        limit: SNAPSHOT_ARTIST_LIMIT,
      }).catch(() => null);

      if (cachedArtists && cachedArtists.length > artists.length) {
        artists = cachedArtists;
      }

      if (artists.length < expectedTotalArtists) {
        const rebuiltArtists = await getCategoryArtistsByGenre(genre, {
          offset: 0,
          limit: SNAPSHOT_ARTIST_LIMIT,
          maxLimit: SNAPSHOT_ARTIST_LIMIT,
          bypassRuntimeCache: true,
        }).catch(() => artists);
        artists = rebuiltArtists;
      }
    }

    if (artists.length > SNAPSHOT_ARTIST_LIMIT) {
      artists = artists.slice(0, SNAPSHOT_ARTIST_LIMIT);
    }

    const detailPayload: CategoriesNewCategorySnapshot = {
      buildVersion,
      generatedAt,
      slug,
      genre,
      totalArtists: Math.max(
        Math.max(0, Number(tabCounts.all ?? 0)),
        Math.max(0, artists.length),
      ),
      tabCounts,
      artists,
    };

    await writeCategoriesNewSnapshot(buildVersion, getCategorySnapshotKey(slug), detailPayload);
  }
}

async function runCategoriesNewSnapshotBuild(reason: string) {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const buildVersion = Date.now();
  await updateCategoriesNewSnapshotState({
    buildStatus: "running",
    activeBuildVersion: await getActiveCategoriesNewBuildVersion(),
    lastError: null,
    touchStartedAt: true,
  });

  try {
    await buildCategoriesNewSnapshotRows(buildVersion);
    await updateCategoriesNewSnapshotState({
      buildStatus: "ready",
      activeBuildVersion: buildVersion,
      lastError: null,
      touchFinishedAt: true,
    });
    await cleanupOldCategoriesNewSnapshots(buildVersion);
    void reason;
    return buildVersion;
  } catch (error) {
    await updateCategoriesNewSnapshotState({
      buildStatus: "failed",
      activeBuildVersion: await getActiveCategoriesNewBuildVersion(),
      lastError: error instanceof Error ? error.message : "unknown error",
      touchFinishedAt: true,
    }).catch(() => undefined);
    throw error;
  }
}

function clearCategoriesNewSnapshotBuildDebounceTimer() {
  if (categoriesNewSnapshotBuildDebounceTimer !== null) {
    clearTimeout(categoriesNewSnapshotBuildDebounceTimer);
    categoriesNewSnapshotBuildDebounceTimer = null;
  }
}

function startCategoriesNewSnapshotBuild(reason: string) {
  categoriesNewSnapshotBuildInFlight = runCategoriesNewSnapshotBuild(reason)
    .catch(() => null)
    .finally(() => {
      categoriesNewSnapshotBuildInFlight = null;

      if (categoriesNewSnapshotBuildQueued) {
        categoriesNewSnapshotBuildQueued = false;
        scheduleCategoriesNewSnapshotBuild(categoriesNewSnapshotBuildPendingReason);
      }
    });
}

export function scheduleCategoriesNewSnapshotBuild(reason = "catalog-change") {
  if (!hasDatabaseUrl()) {
    return;
  }

  categoriesNewSnapshotBuildPendingReason = reason;
  clearCategoriesNewSnapshotBuildDebounceTimer();

  categoriesNewSnapshotBuildDebounceTimer = setTimeout(() => {
    categoriesNewSnapshotBuildDebounceTimer = null;

    if (categoriesNewSnapshotBuildInFlight) {
      categoriesNewSnapshotBuildQueued = true;
      return;
    }

    startCategoriesNewSnapshotBuild(categoriesNewSnapshotBuildPendingReason);
  }, CATEGORIES_NEW_SNAPSHOT_BUILD_DEBOUNCE_MS);

  if (categoriesNewSnapshotBuildInFlight) {
    categoriesNewSnapshotBuildQueued = true;
    return;
  }
}

export async function getCategoriesNewTopLevelSnapshot() {
  return readCategoriesNewSnapshot<CategoriesNewTopLevelSnapshot>(SNAPSHOT_TOP_LEVEL_KEY, true);
}

export async function getCategoriesNewCategorySnapshot(slug: string) {
  const snapshot = await readCategoriesNewSnapshot<CategoriesNewCategorySnapshot>(getCategorySnapshotKey(slug), true);
  if (!snapshot) {
    return null;
  }

  const currentAllCount = Math.max(0, Number(snapshot.tabCounts?.all ?? 0));
  const currentTotalArtists = Math.max(0, Number(snapshot.totalArtists ?? 0));
  if (currentAllCount >= currentTotalArtists) {
    return snapshot;
  }

  const refreshedTabCounts = await getCategoryArtistTabCountsByGenre(snapshot.genre).catch(() => null);
  if (!refreshedTabCounts) {
    return snapshot;
  }

  const refreshedAllCount = Math.max(0, Number(refreshedTabCounts.all ?? 0));
  if (refreshedAllCount <= currentAllCount) {
    return snapshot;
  }

  const healedSnapshot: CategoriesNewCategorySnapshot = {
    ...snapshot,
    tabCounts: refreshedTabCounts,
    totalArtists: Math.max(currentTotalArtists, refreshedAllCount, snapshot.artists.length),
  };

  await writeCategoriesNewSnapshot(snapshot.buildVersion, getCategorySnapshotKey(slug), healedSnapshot).catch(() => undefined);
  return healedSnapshot;
}