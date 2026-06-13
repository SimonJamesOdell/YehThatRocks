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
import { getRuntimeProfilingSnapshot, isRuntimeSqlPressureElevated } from "@/lib/runtime-profiler";

const SNAPSHOT_NAME = "categories_new";
const SNAPSHOT_TOP_LEVEL_KEY = "top-level";
const SNAPSHOT_ARTIST_LIMIT = 25_000;
const CATEGORIES_NEW_SNAPSHOT_BUILD_DEBOUNCE_MS = 5_000;
const CATEGORIES_NEW_SNAPSHOT_PRESSURE_BACKOFF_MS = Math.max(
  5_000,
  Math.min(120_000, Number(process.env.CATEGORIES_NEW_SNAPSHOT_PRESSURE_BACKOFF_MS || "30_000")),
);
// Pause between each genre during a full snapshot rebuild
// to avoid saturating MySQL on small VPS instances.
// Default 1.5s. Set to 0 for no delay.
const CATEGORIES_SNAPSHOT_INTER_GENRE_DELAY_MS = Math.max(
  0,
  Math.min(30_000, Number(process.env.CATEGORIES_SNAPSHOT_INTER_GENRE_DELAY_MS || "1500")),
);

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCategorySnapshotKey(slug: string) {
  return `category:${slug.trim().toLowerCase()}`;
}

async function updateCategoriesNewSnapshotState(args: {
  buildStatus: "idle" | "running" | "ready" | "failed";
  activeBuildVersion?: number | null;
  lastError?: string | null;
  touchStartedAt?: boolean;
  touchFinishedAt?: boolean;
}) {
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

function hasSuspiciousArtistTotal(value: number) {
  return value === 200 || value === 400;
}

function areTopLevelCardsEqual(a: CategoriesNewTopLevelCard[], b: CategoriesNewTopLevelCard[]) {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((card, index) => {
    const other = b[index];
    return Boolean(other)
      && card.genre === other.genre
      && card.slug === other.slug
      && card.previewVideoId === other.previewVideoId
      && Number(card.artistCount ?? 0) === Number(other.artistCount ?? 0);
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

    let artists = await getCachedCategoryArtistsByGenre(genre, {
      offset: 0,
      limit: SNAPSHOT_ARTIST_LIMIT,
    }).catch(() => null) ?? [];

    // Runtime cache rows can be stale/partial for some large buckets; prefer a complete snapshot payload.
    const expectedTotalArtists = Math.max(0, Number(tabCounts.all ?? 0));
    const expectedSnapshotArtists = Math.min(expectedTotalArtists, SNAPSHOT_ARTIST_LIMIT);
    if (artists.length === 0) {
      artists = await getCategoryArtistsByGenre(genre, {
        offset: 0,
        limit: SNAPSHOT_ARTIST_LIMIT,
        maxLimit: SNAPSHOT_ARTIST_LIMIT,
      }).catch(() => []);
    }

    if (artists.length < expectedSnapshotArtists) {
      await warmCategoryArtistRuntimeCacheByGenre(genre).catch(() => undefined);

      const cachedArtists = await getCachedCategoryArtistsByGenre(genre, {
        offset: 0,
        limit: SNAPSHOT_ARTIST_LIMIT,
      }).catch(() => null);

      if (cachedArtists && cachedArtists.length > artists.length) {
        artists = cachedArtists;
      }

      if (artists.length < expectedSnapshotArtists) {
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

    if (CATEGORIES_SNAPSHOT_INTER_GENRE_DELAY_MS > 0) {
      await sleep(CATEGORIES_SNAPSHOT_INTER_GENRE_DELAY_MS);
    }
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

function shouldBackoffCategoriesNewSnapshotBuild() {
  try {
    return isRuntimeSqlPressureElevated(getRuntimeProfilingSnapshot());
  } catch {
    return false;
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

export function scheduleCategoriesNewSnapshotBuild(reason = "catalog-change", options?: { immediate?: boolean }) {
  if (!hasDatabaseUrl()) {
    return;
  }

  categoriesNewSnapshotBuildPendingReason = reason;

  if (shouldBackoffCategoriesNewSnapshotBuild()) {
    clearCategoriesNewSnapshotBuildDebounceTimer();

    categoriesNewSnapshotBuildDebounceTimer = setTimeout(() => {
      categoriesNewSnapshotBuildDebounceTimer = null;
      scheduleCategoriesNewSnapshotBuild(`${categoriesNewSnapshotBuildPendingReason}:retry`);
    }, CATEGORIES_NEW_SNAPSHOT_PRESSURE_BACKOFF_MS);

    return;
  }

  if (options?.immediate) {
    clearCategoriesNewSnapshotBuildDebounceTimer();

    if (categoriesNewSnapshotBuildInFlight) {
      categoriesNewSnapshotBuildQueued = true;
      return;
    }

    startCategoriesNewSnapshotBuild(categoriesNewSnapshotBuildPendingReason);
    return;
  }

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

export async function ensureCategoriesNewSnapshotReady(options?: { maxWaitMs?: number; pollMs?: number }) {
  if (!hasDatabaseUrl()) {
    return false;
  }

  const maxWaitMs = Math.max(0, Number(options?.maxWaitMs ?? 120_000));
  const pollMs = Math.max(250, Number(options?.pollMs ?? 1_000));
  const deadline = Date.now() + maxWaitMs;

  const snapshotBefore = await readCategoriesNewSnapshot<CategoriesNewTopLevelSnapshot>(SNAPSHOT_TOP_LEVEL_KEY, true);
  const hasReadySnapshotBefore = Boolean(snapshotBefore && snapshotBefore.cards.length > 0);
  if (hasReadySnapshotBefore) {
    return true;
  }

  scheduleCategoriesNewSnapshotBuild("startup-warmup", { immediate: true });

  while (Date.now() <= deadline) {
    if (categoriesNewSnapshotBuildInFlight) {
      await categoriesNewSnapshotBuildInFlight.catch(() => undefined);
    }

    const snapshot = await readCategoriesNewSnapshot<CategoriesNewTopLevelSnapshot>(SNAPSHOT_TOP_LEVEL_KEY, true);
    if (snapshot && snapshot.cards.length > 0) {
      return true;
    }

    if (Date.now() >= deadline) {
      break;
    }

    await sleep(pollMs);
    scheduleCategoriesNewSnapshotBuild("startup-warmup-retry", { immediate: true });
  }

  return false;
}

export async function getCategoriesNewTopLevelSnapshot() {
  const snapshot = await readCategoriesNewSnapshot<CategoriesNewTopLevelSnapshot>(SNAPSHOT_TOP_LEVEL_KEY, true);
  if (!snapshot) {
    return null;
  }

  const hasSuspiciousCounts = snapshot.cards.some((card) => hasSuspiciousArtistTotal(Math.max(0, Number(card.artistCount ?? 0))));
  if (!hasSuspiciousCounts) {
    return snapshot;
  }

  const refreshedCards = normalizeTopLevelCards(
    await getGenreCards().catch(() => snapshot.cards),
  );

  if (areTopLevelCardsEqual(snapshot.cards, refreshedCards)) {
    return snapshot;
  }

  const healedSnapshot: CategoriesNewTopLevelSnapshot = {
    ...snapshot,
    generatedAt: new Date().toISOString(),
    cards: refreshedCards,
  };

  await writeCategoriesNewSnapshot(snapshot.buildVersion, SNAPSHOT_TOP_LEVEL_KEY, healedSnapshot).catch(() => undefined);
  return healedSnapshot;
}

export async function getCategoriesNewCategorySnapshot(slug: string) {
  const snapshot = await readCategoriesNewSnapshot<CategoriesNewCategorySnapshot>(getCategorySnapshotKey(slug), true);
  if (!snapshot) {
    return null;
  }

  const currentAllCount = Math.max(0, Number(snapshot.tabCounts?.all ?? 0));
  const currentTotalArtists = Math.max(0, Number(snapshot.totalArtists ?? 0));
  const hasSuspiciousTotals = hasSuspiciousArtistTotal(currentAllCount) || hasSuspiciousArtistTotal(currentTotalArtists);
  if (currentAllCount >= currentTotalArtists && !hasSuspiciousTotals) {
    return snapshot;
  }

  const refreshedTabCounts = await getCategoryArtistTabCountsByGenre(snapshot.genre).catch(() => null);
  if (!refreshedTabCounts) {
    return snapshot;
  }

  const refreshedAllCount = Math.max(0, Number(refreshedTabCounts.all ?? 0));
  const needsArtistListRepair = snapshot.artists.length < refreshedAllCount;
  if (refreshedAllCount <= currentAllCount && !needsArtistListRepair) {
    return snapshot;
  }

  let healedArtists = snapshot.artists;
  if (needsArtistListRepair) {
    healedArtists = await getCategoryArtistsByGenre(snapshot.genre, {
      offset: 0,
      limit: SNAPSHOT_ARTIST_LIMIT,
      maxLimit: SNAPSHOT_ARTIST_LIMIT,
      bypassRuntimeCache: true,
    }).catch(() => healedArtists);
  }

  const healedSnapshot: CategoriesNewCategorySnapshot = {
    ...snapshot,
    tabCounts: refreshedTabCounts,
    artists: healedArtists,
    totalArtists: Math.max(currentTotalArtists, refreshedAllCount, healedArtists.length),
  };

  await writeCategoriesNewSnapshot(snapshot.buildVersion, getCategorySnapshotKey(slug), healedSnapshot).catch(() => undefined);
  return healedSnapshot;
}