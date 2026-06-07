import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRawUnsafeMock = vi.fn();
const queryRawUnsafeMock = vi.fn();

const getCachedCategoryArtistsByGenreMock = vi.fn();
const getCategoryArtistTabCountsByGenreMock = vi.fn();
const getCategoryArtistsByGenreMock = vi.fn();
const getGenreCardsMock = vi.fn();
const getRuntimeCachedTopLevelGenreCardsMock = vi.fn();
const warmCategoryArtistRuntimeCacheByGenreMock = vi.fn();
const getRuntimeProfilingSnapshotMock = vi.fn();
const isRuntimeSqlPressureElevatedMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRawUnsafe: executeRawUnsafeMock,
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

vi.mock("@/lib/catalog-data-genres", () => ({
  getCachedCategoryArtistsByGenre: getCachedCategoryArtistsByGenreMock,
  getCategoryArtistTabCountsByGenre: getCategoryArtistTabCountsByGenreMock,
  getCategoryArtistsByGenre: getCategoryArtistsByGenreMock,
  getGenreCards: getGenreCardsMock,
  getRuntimeCachedTopLevelGenreCards: getRuntimeCachedTopLevelGenreCardsMock,
  warmCategoryArtistRuntimeCacheByGenre: warmCategoryArtistRuntimeCacheByGenreMock,
}));

vi.mock("@/lib/catalog-data-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog-data-utils")>("@/lib/catalog-data-utils");
  return {
    ...actual,
    hasDatabaseUrl: () => true,
  };
});

vi.mock("@/lib/runtime-profiler", () => ({
  getRuntimeProfilingSnapshot: getRuntimeProfilingSnapshotMock,
  isRuntimeSqlPressureElevated: isRuntimeSqlPressureElevatedMock,
}));

describe("categories-new snapshot build cache-first behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    executeRawUnsafeMock.mockReset();
    queryRawUnsafeMock.mockReset();
    getCachedCategoryArtistsByGenreMock.mockReset();
    getCategoryArtistTabCountsByGenreMock.mockReset();
    getCategoryArtistsByGenreMock.mockReset();
    getGenreCardsMock.mockReset();
    getRuntimeCachedTopLevelGenreCardsMock.mockReset();
    warmCategoryArtistRuntimeCacheByGenreMock.mockReset();
    getRuntimeProfilingSnapshotMock.mockReset();
    isRuntimeSqlPressureElevatedMock.mockReset();

    getRuntimeProfilingSnapshotMock.mockReturnValue({});
    isRuntimeSqlPressureElevatedMock.mockReturnValue(false);

    const dbState = {
      activeBuildVersion: null as number | null,
      snapshots: new Map<string, string>(),
    };

    executeRawUnsafeMock.mockImplementation((sql: unknown, ...args: unknown[]) => {
      const text = String(sql);

      if (text.includes("INSERT INTO category_page_snapshot_state")) {
        dbState.activeBuildVersion = (args[1] as number | null) ?? null;
        return Promise.resolve(1);
      }

      if (text.includes("INSERT INTO category_page_snapshots")) {
        const buildVersion = Number(args[1]);
        const pageKey = String(args[2]);
        const payloadJson = String(args[3]);
        dbState.snapshots.set(`${buildVersion}:${pageKey}`, payloadJson);
        return Promise.resolve(1);
      }

      if (text.includes("DELETE FROM category_page_snapshots") && dbState.activeBuildVersion !== null) {
        for (const key of Array.from(dbState.snapshots.keys())) {
          if (!key.startsWith(`${dbState.activeBuildVersion}:`)) {
            dbState.snapshots.delete(key);
          }
        }
        return Promise.resolve(1);
      }

      return Promise.resolve(1);
    });

    queryRawUnsafeMock.mockImplementation((sql: unknown, ...args: unknown[]) => {
      const text = String(sql);

      if (text.includes("SELECT active_build_version AS activeBuildVersion")) {
        return Promise.resolve([{ activeBuildVersion: dbState.activeBuildVersion }]);
      }

      if (text.includes("SELECT payload_json AS payloadJson")) {
        const buildVersion = Number(args[1]);
        const pageKey = String(args[2]);
        const payloadJson = dbState.snapshots.get(`${buildVersion}:${pageKey}`);
        return Promise.resolve(payloadJson ? [{ payloadJson }] : []);
      }

      return Promise.resolve([]);
    });

    const artists = [
      {
        name: "Metallica",
        slug: "metallica",
        videoCount: 5,
        thumbnailVideoId: "AAAAAAAAAAA",
        dominantGenre: "thrash metal",
      },
      {
        name: "Megadeth",
        slug: "megadeth",
        videoCount: 4,
        thumbnailVideoId: "BBBBBBBBBBB",
        dominantGenre: "thrash metal",
      },
    ];

    getRuntimeCachedTopLevelGenreCardsMock.mockResolvedValue([
      {
        genre: "Thrash & Power Metal",
        previewVideoId: "AAAAAAAAAAA",
        artistCount: 2,
      },
    ]);
    getGenreCardsMock.mockResolvedValue([]);
    warmCategoryArtistRuntimeCacheByGenreMock.mockResolvedValue({ warmed: false, count: 2 });
    getCategoryArtistTabCountsByGenreMock.mockResolvedValue({ all: 2, thrash: 2, "power-speed": 0, groove: 0 });
    getCachedCategoryArtistsByGenreMock.mockResolvedValue(artists);
    getCategoryArtistsByGenreMock.mockResolvedValue(artists);
  });

  it("prefers cached artist payloads and avoids forced bypass reads when cache is complete", async () => {
    const { ensureCategoriesNewSnapshotReady, scheduleCategoriesNewSnapshotBuild } = await import("@/lib/categories-new-snapshots");

    scheduleCategoriesNewSnapshotBuild("test-cache-first", { immediate: true });
    const ready = await ensureCategoriesNewSnapshotReady({ maxWaitMs: 5_000, pollMs: 50 });

    expect(ready).toBe(true);
    expect(getCachedCategoryArtistsByGenreMock).toHaveBeenCalled();

    const forcedBypassCall = getCategoryArtistsByGenreMock.mock.calls.find(([, options]) =>
      typeof options === "object" && options !== null && (options as { bypassRuntimeCache?: boolean }).bypassRuntimeCache === true,
    );
    expect(forcedBypassCall).toBeUndefined();
  });

  it("does not force bypass reads when cached artists already hit snapshot cap", async () => {
    const cappedArtists = Array.from({ length: 25_000 }, (_, index) => ({
      name: `Artist ${index}`,
      slug: `artist-${index}`,
      videoCount: 1,
      thumbnailVideoId: null,
      dominantGenre: "metal",
    }));

    getCategoryArtistTabCountsByGenreMock.mockResolvedValue({ all: 30_500, thrash: 100, "power-speed": 100, groove: 0 });
    getCachedCategoryArtistsByGenreMock.mockResolvedValue(cappedArtists);

    const { ensureCategoriesNewSnapshotReady, scheduleCategoriesNewSnapshotBuild } = await import("@/lib/categories-new-snapshots");

    scheduleCategoriesNewSnapshotBuild("test-snapshot-cap-skip-bypass", { immediate: true });
    const ready = await ensureCategoriesNewSnapshotReady({ maxWaitMs: 5_000, pollMs: 50 });

    expect(ready).toBe(true);

    const forcedBypassCall = getCategoryArtistsByGenreMock.mock.calls.find(([, options]) =>
      typeof options === "object" && options !== null && (options as { bypassRuntimeCache?: boolean }).bypassRuntimeCache === true,
    );
    expect(forcedBypassCall).toBeUndefined();
  });

  it("never executes snapshot table DDL during runtime read/write flow", async () => {
    const { ensureCategoriesNewSnapshotReady, getCategoriesNewTopLevelSnapshot, getCategoriesNewCategorySnapshot, scheduleCategoriesNewSnapshotBuild } = await import("@/lib/categories-new-snapshots");

    scheduleCategoriesNewSnapshotBuild("test-ddl-single-bootstrap", { immediate: true });
    const ready = await ensureCategoriesNewSnapshotReady({ maxWaitMs: 5_000, pollMs: 50 });

    expect(ready).toBe(true);

    await getCategoriesNewTopLevelSnapshot();
    await getCategoriesNewCategorySnapshot("thrash-power-metal");

    const bootstrapDdlCalls = executeRawUnsafeMock.mock.calls.filter(([sql]) =>
      String(sql).includes("CREATE TABLE IF NOT EXISTS category_page_snapshot"),
    );

    expect(bootstrapDdlCalls).toHaveLength(0);
  });

  it("heals suspicious top-level snapshot counts from refreshed genre cards", async () => {
    getRuntimeCachedTopLevelGenreCardsMock.mockResolvedValue([
      {
        genre: "Thrash & Power Metal",
        previewVideoId: "AAAAAAAAAAA",
        artistCount: 400,
      },
    ]);
    getGenreCardsMock.mockResolvedValue([
      {
        genre: "Thrash & Power Metal",
        previewVideoId: "AAAAAAAAAAA",
        artistCount: 931,
      },
    ]);

    const {
      ensureCategoriesNewSnapshotReady,
      getCategoriesNewTopLevelSnapshot,
      scheduleCategoriesNewSnapshotBuild,
    } = await import("@/lib/categories-new-snapshots");

    scheduleCategoriesNewSnapshotBuild("test-suspicious-count-heal", { immediate: true });
    const ready = await ensureCategoriesNewSnapshotReady({ maxWaitMs: 5_000, pollMs: 50 });
    expect(ready).toBe(true);

    const snapshot = await getCategoriesNewTopLevelSnapshot();
    const thrashCard = snapshot?.cards.find((card) => card.genre === "Thrash & Power Metal");

    expect(thrashCard?.artistCount).toBe(931);
  });

  it("defers immediate snapshot rebuild when runtime SQL pressure is elevated", async () => {
    const { ensureCategoriesNewSnapshotReady, scheduleCategoriesNewSnapshotBuild } = await import("@/lib/categories-new-snapshots");

    vi.useFakeTimers();
    isRuntimeSqlPressureElevatedMock.mockReturnValue(true);

    scheduleCategoriesNewSnapshotBuild("test-pressure-backoff", { immediate: true });
    await vi.runOnlyPendingTimersAsync();

    expect(getCachedCategoryArtistsByGenreMock).not.toHaveBeenCalled();

    isRuntimeSqlPressureElevatedMock.mockReturnValue(false);
    scheduleCategoriesNewSnapshotBuild("test-pressure-backoff-release", { immediate: true });

    const readyPromise = ensureCategoriesNewSnapshotReady({ maxWaitMs: 5_000, pollMs: 50 });
    await vi.runAllTimersAsync();
    const ready = await readyPromise;

    expect(ready).toBe(true);
    expect(getCachedCategoryArtistsByGenreMock).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
