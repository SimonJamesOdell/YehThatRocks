import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Top-level mock setup ──────────────────────────────────────────────────────

const queryRawUnsafeMock = vi.fn();
const queryRawMock = vi.fn();
const getArtistColumnMapMock = vi.fn();
const hasGenreAllColumnMock = vi.fn();
const hasVideoTitleFulltextIndexMock = vi.fn();
const hasVideoGenreColumnMock = vi.fn();
const hasVideoGenreNormColumnMock = vi.fn();
const getVideoArtistNormalizationColumnMock = vi.fn();
const getVideoArtistNormalizationIndexHintClauseMock = vi.fn();
const getRuntimeProfilingSnapshotMock = vi.fn();
const isRuntimeSqlPressureElevatedMock = vi.fn();

const originalDatabaseUrl = process.env.DATABASE_URL;

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
    $queryRaw: queryRawMock,
  },
}));

vi.mock("@/lib/catalog-data-db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog-data-db")>("@/lib/catalog-data-db");
  return {
    ...actual,
    getArtistColumnMap: getArtistColumnMapMock,
    hasGenreAllColumn: hasGenreAllColumnMock,
    hasVideoTitleFulltextIndex: hasVideoTitleFulltextIndexMock,
    hasVideoGenreColumn: hasVideoGenreColumnMock,
    hasVideoGenreNormColumn: hasVideoGenreNormColumnMock,
    getVideoArtistNormalizationColumn: getVideoArtistNormalizationColumnMock,
    getVideoArtistNormalizationIndexHintClause: getVideoArtistNormalizationIndexHintClauseMock,
  };
});

vi.mock("@/lib/runtime-profiler", () => ({
  getRuntimeProfilingSnapshot: getRuntimeProfilingSnapshotMock,
  isRuntimeSqlPressureElevated: isRuntimeSqlPressureElevatedMock,
}));

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
});

// ── getArtistsByGenre ─────────────────────────────────────────────────────────

describe("getArtistsByGenre — genre_all FULLTEXT strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    hasGenreAllColumnMock.mockReset();
    getArtistColumnMapMock.mockReset();
  });

  it("uses MATCH AGAINST on genre_all when column exists and genre >= 3 chars", async () => {
    hasGenreAllColumnMock.mockResolvedValue(true);
    queryRawMock.mockResolvedValue([
      { name: "Iron Maiden", country: "UK", genre1: "Heavy Metal" },
    ]);

    const { clearGenreCaches, getArtistsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getArtistsByGenre("zeuhl");

    // Must have used $queryRaw (template literal) with FULLTEXT — not $queryRawUnsafe
    expect(queryRawMock).toHaveBeenCalled();
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    const callArg = String(queryRawMock.mock.calls[0][0]);
    expect(callArg).toContain("MATCH");
    expect(callArg).toContain("genre_all");
    expect(callArg).toContain("MAX_EXECUTION_TIME");
    expect(callArg).not.toContain("genre1 LIKE");
  });

  it("uses genre_all LIKE for short genre (< 3 chars) when column exists", async () => {
    hasGenreAllColumnMock.mockResolvedValue(true);
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getArtistsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getArtistsByGenre("Nu"); // 2 chars

    expect(queryRawUnsafeMock).toHaveBeenCalled();
    const callArg = String(queryRawUnsafeMock.mock.calls[0][0]);
    expect(callArg).toContain("genre_all");
    expect(callArg).toContain("LIKE");
    expect(callArg).toContain("MAX_EXECUTION_TIME");
    expect(callArg).not.toContain("MATCH");
    // Must NOT be the 6× LIKE fallback
    expect(callArg).not.toContain("genre1 LIKE");
    expect(callArg).not.toContain("genre2 LIKE");
  });

  it("skips DB genre matching when genre_all column does not exist", async () => {
    hasGenreAllColumnMock.mockResolvedValue(false);
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getArtistsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const result = await getArtistsByGenre("Metal");

    expect(result).toEqual([]);
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("falls back to seed data when no DB configured", async () => {
    delete process.env.DATABASE_URL;

    const { clearGenreCaches, getArtistsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const result = await getArtistsByGenre("Metal");

    expect(queryRawMock).not.toHaveBeenCalled();
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── getVideosByGenre — artist genre lookup ────────────────────────────────────

describe("getVideosByGenre — artist genre FULLTEXT strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    hasGenreAllColumnMock.mockReset();
    hasVideoGenreColumnMock.mockReset();
    hasVideoGenreNormColumnMock.mockReset();
    getArtistColumnMapMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    getArtistColumnMapMock.mockResolvedValue({
      name: "artist",
      normalizedName: null,
      country: "country",
      genreColumns: ["genre1", "genre2"],
    });
    hasVideoGenreColumnMock.mockResolvedValue(true);
    hasVideoGenreNormColumnMock.mockResolvedValue(true);
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue("");
  });

  it("uses MATCH AGAINST on genre_all when column exists and genre >= 3 chars", async () => {
    hasGenreAllColumnMock.mockResolvedValue(true);

    // getGenreKeywordVideos call (template literal $queryRaw returns empty)
    queryRawMock.mockResolvedValue([]);
    // artist genre FULLTEXT lookup ($queryRawUnsafe) returns no artists
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getVideosByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getVideosByGenre("zeuhl");

    // There should be a $queryRawUnsafe call for the artist genre lookup
    expect(queryRawUnsafeMock).toHaveBeenCalled();
    const genreLookupCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("artistName"),
    );
    expect(genreLookupCall).toBeDefined();
    const [sql] = genreLookupCall!;
    expect(String(sql)).toContain("MATCH");
    expect(String(sql)).toContain("genre_all");
    expect(String(sql)).toContain("MAX_EXECUTION_TIME");
    expect(String(sql)).not.toContain("genre1 LIKE");
    expect(String(sql)).not.toContain("genre2 LIKE");
  });

  it("uses genre_all LIKE for short genre (< 3 chars) when column exists", async () => {
    hasGenreAllColumnMock.mockResolvedValue(true);

    queryRawMock.mockResolvedValue([]);
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getVideosByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getVideosByGenre("Nu");

    const genreLookupCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("artistName"),
    );
    expect(genreLookupCall).toBeDefined();
    const [sql, param] = genreLookupCall!;
    expect(String(sql)).toContain("genre_all");
    expect(String(sql)).toContain("LIKE");
    expect(String(sql)).toContain("MAX_EXECUTION_TIME");
    expect(String(sql)).not.toContain("MATCH");
    expect(String(sql)).not.toContain("genre1 LIKE");
    expect(String(param)).toContain("nu");
  });

  it("does not issue 6× LIKE artist fallback when genre_all column does not exist", async () => {
    hasGenreAllColumnMock.mockResolvedValue(false);

    queryRawMock.mockResolvedValue([]);
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getVideosByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getVideosByGenre("Metal");

    const genreLookupCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("AS artistName FROM artists a WHERE"),
    );
    expect(genreLookupCall).toBeUndefined();

    const emittedSixLikeFallback = queryRawUnsafeMock.mock.calls.some(([sql]) =>
      /a\.genre[1-6]\s+LIKE/.test(String(sql)),
    );
    expect(emittedSixLikeFallback).toBe(false);
  });

  it("reuses cached artist genre lookup for repeated requests", async () => {
    hasGenreAllColumnMock.mockResolvedValue(true);

    queryRawMock.mockResolvedValue([]);
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("AS artistName FROM artists a WHERE")) {
        return [{ artistName: "Iron Maiden" }];
      }
      return [];
    });

    const { clearGenreCaches, getVideosByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getVideosByGenre("Metal", { artists: [] });
    await getVideosByGenre("Metal", { artists: [] });

    const artistLookupCalls = queryRawUnsafeMock.mock.calls.filter(([sql]) =>
      String(sql).includes("AS artistName FROM artists a WHERE"),
    );
    expect(artistLookupCalls).toHaveLength(1);
  });

  it("skips artist genre lookup when keyword query already fills the requested window", async () => {
    hasGenreAllColumnMock.mockResolvedValue(false);

    queryRawMock.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("MATCH(v.title, v.parsedArtist, v.parsedTrack)")) {
        return Array.from({ length: 24 }, (_, index) => ({
          videoId: `VID${String(index).padStart(8, "0")}`,
          title: `Video ${index}`,
          channelTitle: null,
          favourited: 100 - index,
          description: null,
        }));
      }
      return [];
    });
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getVideosByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const videos = await getVideosByGenre("Metal");

    expect(videos).toHaveLength(24);
    const artistLookupCalls = queryRawUnsafeMock.mock.calls.filter(([sql]) =>
      String(sql).includes("AS artistName FROM artists a WHERE"),
    );
    expect(artistLookupCalls).toHaveLength(0);
  });
});

// ── getVideosByGenre — textMatchedVideos FULLTEXT strategy (Hotspot 6) ────────

describe("getVideosByGenre — textMatchedVideos FULLTEXT strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    hasGenreAllColumnMock.mockReset();
    hasVideoTitleFulltextIndexMock.mockReset();
    hasVideoGenreColumnMock.mockReset();
    hasVideoGenreNormColumnMock.mockReset();
    getArtistColumnMapMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    // Default: genre_all and video FT index both available
    hasGenreAllColumnMock.mockResolvedValue(true);
    hasVideoTitleFulltextIndexMock.mockResolvedValue(true);
    hasVideoGenreColumnMock.mockResolvedValue(true);
    hasVideoGenreNormColumnMock.mockResolvedValue(true);
    getArtistColumnMapMock.mockResolvedValue({
      name: "artist",
      normalizedName: null,
      country: "country",
      genreColumns: ["genre1", "genre2"],
    });
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue("");
  });

  // Helper: drive getVideosByGenre all the way to the textMatchedVideos fallback.
  // The waterfall is:
  //   1. $queryRawUnsafe: getStrictGenreColumnVideos (v.genre_norm) → empty
  //   2. $queryRaw: getGenreKeywordVideos (FULLTEXT on title/artist/track) → empty
  //   3. $queryRawUnsafe: artist genre lookup (MATCH on genre_all) → empty
  //   4. $queryRaw: getArtistsByGenre internal MATCH → returns 1 artist so we don't early-exit
  //   5. $queryRaw: FULLTEXT video lookup using artist names → empty
  //   6. $queryRawUnsafe: artist normalized name video lookup → empty
  //   7. textMatchedVideos → the call we want to observe
  async function driveToTextMatch(genre: string) {
    queryRawMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("MATCH(a.genre_all)")) {
        return [{ name: "Iron Maiden", country: "US", genre1: "Metal" }];
      }

      return [];
    });

    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("a.genre_all LIKE") || text.includes("a.genre1 LIKE")) {
        return [{ name: "Iron Maiden", country: "US", genre1: "Metal" }];
      }

      return [];
    });

    const { clearGenreCaches, getVideosByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getVideosByGenre(genre);
  }

  it("uses MATCH AGAINST on video title/artist/track when FT index exists and genre >= 3 chars", async () => {
    await driveToTextMatch("Doom");

    // textMatchedVideos query goes through $queryRawUnsafe
    const textMatchCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("MATCH(v.title"),
    );
    expect(textMatchCall).toBeDefined();
    const [sql] = textMatchCall!;
    expect(sql).toContain("MATCH(v.title, v.parsedArtist, v.parsedTrack)");
    expect(sql).toContain("AGAINST");
    expect(sql).toContain("MAX_EXECUTION_TIME");
    // Must NOT use the old 4× LOWER() LIKE pattern
    expect(sql).not.toContain("LOWER(v.title)");
    expect(sql).not.toContain("LOWER(COALESCE(v.description");
  });

  it("uses simplified LIKE (no LOWER) when FT index absent", async () => {
    hasVideoTitleFulltextIndexMock.mockResolvedValue(false);

    await driveToTextMatch("Doom");

    const textMatchCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      typeof sql === "string" && (sql.includes("v.title LIKE") || sql.includes("LOWER(v.title)")),
    );
    expect(textMatchCall).toBeDefined();
    const [sql] = textMatchCall!;
    // No LOWER() — utf8mb4_unicode_ci is already case-insensitive
    expect(sql).toContain("MAX_EXECUTION_TIME");
    expect(sql).not.toContain("LOWER(v.title)");
    expect(sql).not.toContain("LOWER(COALESCE(v.description");
    // No FULLTEXT
    expect(sql).not.toContain("MATCH(v.title");
  });

  it("uses simplified LIKE for short genre (< 3 chars) even when FT index exists", async () => {
    await driveToTextMatch("Nu");

    const textMatchCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      typeof sql === "string" && (sql.includes("v.title LIKE") || sql.includes("MATCH(v.title")),
    );
    expect(textMatchCall).toBeDefined();
    const [sql] = textMatchCall!;
    // FULLTEXT minimum word length is 3 — must fall back to LIKE for "Nu"
    expect(sql).toContain("MAX_EXECUTION_TIME");
    expect(sql).not.toContain("MATCH(v.title");
    expect(sql).not.toContain("LOWER(v.title)");
  });
});

// ── getCategoryArtistCountByGenre — distinct count strategy ─────────────────

describe("getCategoryArtistCountByGenre — distinct artist count strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    hasVideoGenreColumnMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    hasVideoGenreColumnMock.mockResolvedValue(true);
    getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue(" FORCE INDEX (idx_videos_parsed_artist_norm_fav_view_videoid_id)");
  });

  it("uses index-first UNION strategy when parsed_artist_norm exists", async () => {
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return [];
      }
      return [{ total: 123 }];
    });

    const { clearGenreCaches, getCategoryArtistCountByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const total = await getCategoryArtistCountByGenre("Metal");

    expect(total).toBe(123);
    const unionCall = queryRawUnsafeMock.mock.calls.find(([sql]) => String(sql).includes("UNION"));
    expect(unionCall).toBeDefined();
    const [sql] = unionCall as [string, ...unknown[]];
    expect(sql).toContain("UNION");
    expect(sql).toContain("parsed_artist_norm");
    expect(sql).toContain("COUNT(*) AS total");
    expect(sql).not.toContain("COUNT(DISTINCT LOWER(TRIM(COALESCE");
  });

  it("uses runtime cache total when available to avoid heavy regroup count", async () => {
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return [{ tableName: "category_artist_runtime_cache" }];
      }
      if (text.includes("MAX(updated_at) AS newestUpdatedAt") && text.includes("FROM category_artist_runtime_cache")) {
        return [{ newestUpdatedAt: new Date(), total: 42 }];
      }
      return [{ total: 0 }];
    });

    const { clearGenreCaches, getCategoryArtistCountByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const total = await getCategoryArtistCountByGenre("Metal");

    expect(total).toBe(42);
    expect(getVideoArtistNormalizationColumnMock).not.toHaveBeenCalled();
    const unionCall = queryRawUnsafeMock.mock.calls.find(([sql]) => String(sql).includes("UNION"));
    expect(unionCall).toBeUndefined();
  });

  it("keeps expression DISTINCT fallback when parsed_artist_norm is unavailable", async () => {
    getVideoArtistNormalizationColumnMock.mockResolvedValue(null);
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return [];
      }
      return [{ total: 7 }];
    });

    const { clearGenreCaches, getCategoryArtistCountByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const total = await getCategoryArtistCountByGenre("Metal");

    expect(total).toBe(7);
    const distinctCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("COUNT(DISTINCT LOWER(TRIM(COALESCE(NULLIF(v.parsedArtist, ''), NULLIF(v.channelTitle, ''))))) AS total"),
    );
    expect(distinctCall).toBeDefined();
    const [sql] = distinctCall as [string, ...unknown[]];
    expect(sql).toContain("COUNT(DISTINCT LOWER(TRIM(COALESCE(NULLIF(v.parsedArtist, ''), NULLIF(v.channelTitle, ''))))) AS total");
    expect(sql).not.toContain("UNION");
  });
});

describe("getCategoryArtistsByGenre — split aggregation strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    hasVideoGenreColumnMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    hasVideoGenreColumnMock.mockResolvedValue(true);
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue(" FORCE INDEX (idx_videos_parsed_artist_norm_fav_view_videoid_id)");
  });

  it("uses two-step query path for normalized artist columns", async () => {
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_thumbnails'")) {
        return [];
      }

      if (text.includes("COUNT(*) AS videoCount") && text.includes("GROUP BY v.`parsed_artist_norm`")) {
        return [
          { artistKey: "metallica", artistName: "Metallica", videoCount: 5 },
          { artistKey: "megadeth", artistName: "Megadeth", videoCount: 3 },
        ];
      }

      if (text.includes("ROW_NUMBER() OVER") && text.includes("PARTITION BY v.`parsed_artist_norm`")) {
        return [
          { artistKey: "metallica", thumbnailVideoId: "AAAAAAAAAAA", dominantGenre: "thrash metal" },
          { artistKey: "megadeth", thumbnailVideoId: "BBBBBBBBBBB", dominantGenre: "thrash metal" },
        ];
      }

      return [];
    });

    const { clearGenreCaches, getCategoryArtistsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const rows = await getCategoryArtistsByGenre("Thrash & Power Metal", {
      offset: 0,
      limit: 2,
      bypassRuntimeCache: true,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("Metallica");
    expect(rows[0]?.thumbnailVideoId).toBe("AAAAAAAAAAA");

    const headAggregationCall = queryRawUnsafeMock.mock.calls.find(([sql]) => {
      const text = String(sql);
      return text.includes("COUNT(*) AS videoCount")
        && text.includes("GROUP BY v.`parsed_artist_norm`")
        && !text.includes("GROUP_CONCAT(v.videoId");
    });
    expect(headAggregationCall).toBeDefined();

    const detailAggregationCall = queryRawUnsafeMock.mock.calls.find(([sql]) => {
      const text = String(sql);
      return text.includes("ROW_NUMBER() OVER")
        && text.includes("PARTITION BY v.`parsed_artist_norm`")
        && text.includes("IN (");
    });
    expect(detailAggregationCall).toBeDefined();

    const [detailSql] = detailAggregationCall as [string, ...unknown[]];
    expect(detailSql).not.toContain("GROUP_CONCAT(");
  });
});

describe("category artist count and tab-count runtime-cache optimization", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    hasVideoGenreColumnMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    hasVideoGenreColumnMock.mockResolvedValue(true);
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue(" FORCE INDEX (idx_videos_parsed_artist_norm_fav_view_videoid_id)");
  });

  it("uses runtime cache metadata for tab counts and skips heavy UNION regroup queries", async () => {
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return Promise.resolve([{ tableName: "category_artist_runtime_cache" }]);
      }

      if (text.includes("MAX(updated_at) AS newestUpdatedAt") && text.includes("FROM category_artist_runtime_cache")) {
        return Promise.resolve([{ newestUpdatedAt: new Date(), total: 3 }]);
      }

      if (text.includes("FROM category_artist_runtime_cache") && text.includes("artist_name AS artistName")) {
        return Promise.resolve([
          { artistName: "Metallica", thumbnailVideoId: "AAAAAAAAAAA", dominantGenre: "thrash metal", videoCount: 10 },
          { artistName: "Blind Guardian", thumbnailVideoId: "BBBBBBBBBBB", dominantGenre: "power metal", videoCount: 8 },
          { artistName: "Lamb of God", thumbnailVideoId: "CCCCCCCCCCC", dominantGenre: "groove metal", videoCount: 6 },
        ]);
      }

      return Promise.resolve([]);
    });

    const { clearGenreCaches, getCategoryArtistTabCountsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const counts = await getCategoryArtistTabCountsByGenre("Thrash & Power Metal");

    expect(counts).toEqual({
      all: 3,
      thrash: 1,
      "power-speed": 1,
      groove: 1,
    });

    const heavyUnionCall = queryRawUnsafeMock.mock.calls.find(([sql]) => String(sql).includes("UNION"));
    expect(heavyUnionCall).toBeUndefined();

    const heavyDominantGenreCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("GROUP_CONCAT(NULLIF(TRIM(v.genre), '')"),
    );
    expect(heavyDominantGenreCall).toBeUndefined();
  });

  it("falls back to authoritative UNION count when runtime cache is likely truncated", async () => {
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return Promise.resolve([{ tableName: "category_artist_runtime_cache" }]);
      }

      if (text.includes("MAX(updated_at) AS newestUpdatedAt") && text.includes("FROM category_artist_runtime_cache")) {
        return Promise.resolve([{ newestUpdatedAt: new Date(), total: 25_000 }]);
      }

      if (text.includes("SELECT COUNT(*) AS total") && text.includes("UNION")) {
        return Promise.resolve([{ total: 25_731 }]);
      }

      return Promise.resolve([]);
    });

    const { clearGenreCaches, getCategoryArtistCountByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const total = await getCategoryArtistCountByGenre("Metal");

    expect(total).toBe(25_731);
    const heavyUnionCall = queryRawUnsafeMock.mock.calls.find(([sql]) => String(sql).includes("UNION"));
    expect(heavyUnionCall).toBeDefined();
  });

  it("treats legacy 400-row runtime totals as suspicious and re-checks authoritative count", async () => {
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return Promise.resolve([{ tableName: "category_artist_runtime_cache" }]);
      }

      if (text.includes("MAX(updated_at) AS newestUpdatedAt") && text.includes("FROM category_artist_runtime_cache")) {
        return Promise.resolve([{ newestUpdatedAt: new Date(), total: 400 }]);
      }

      if (text.includes("SELECT COUNT(*) AS total") && text.includes("UNION")) {
        return Promise.resolve([{ total: 931 }]);
      }

      return Promise.resolve([]);
    });

    const { clearGenreCaches, getCategoryArtistCountByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const total = await getCategoryArtistCountByGenre("Thrash & Power Metal");

    expect(total).toBe(931);
    const heavyUnionCall = queryRawUnsafeMock.mock.calls.find(([sql]) => String(sql).includes("UNION"));
    expect(heavyUnionCall).toBeDefined();
  });

  it("uses row-number dominant-genre fallback for tab counts without companion UNION count", async () => {
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return Promise.resolve([]);
      }

      if (text.includes("ROW_NUMBER() OVER") && text.includes("dominantGenre")) {
        return Promise.resolve([
          { dominantGenre: "thrash metal" },
          { dominantGenre: "power metal" },
        ]);
      }

      return Promise.resolve([]);
    });

    const { clearGenreCaches, getCategoryArtistTabCountsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const counts = await getCategoryArtistTabCountsByGenre("Thrash & Power Metal");

    expect(counts).toEqual({
      all: 2,
      thrash: 1,
      "power-speed": 1,
      groove: 0,
    });

    const companionCountCall = queryRawUnsafeMock.mock.calls.find(([sql]) => {
      const text = String(sql);
      return text.includes("SELECT COUNT(*) AS total") && text.includes("UNION");
    });
    expect(companionCountCall).toBeUndefined();

    const dominantGenreQuery = queryRawUnsafeMock.mock.calls.find(([sql]) => String(sql).includes("ROW_NUMBER() OVER"));
    expect(dominantGenreQuery).toBeDefined();
    const [sql] = dominantGenreQuery as [string, ...unknown[]];
    expect(sql).not.toContain("GROUP_CONCAT(");
  });
});

describe("runtime cache maintenance write-pressure guards", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    hasVideoGenreColumnMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    hasVideoGenreColumnMock.mockResolvedValue(true);
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue(" FORCE INDEX (idx_videos_parsed_artist_norm_fav_view_videoid_id)");
    getRuntimeProfilingSnapshotMock.mockReset();
    isRuntimeSqlPressureElevatedMock.mockReset();
    getRuntimeProfilingSnapshotMock.mockReturnValue({});
    isRuntimeSqlPressureElevatedMock.mockReturnValue(false);
  });

  it("skips warm rebuild writes when runtime cache is fresh and complete", async () => {
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return Promise.resolve([{ tableName: "category_artist_runtime_cache" }]);
      }

      if (text.includes("MAX(updated_at) AS newestUpdatedAt") && text.includes("FROM category_artist_runtime_cache")) {
        return Promise.resolve([{ newestUpdatedAt: new Date(), total: 123 }]);
      }

      return Promise.resolve([]);
    });

    const { clearGenreCaches, warmCategoryArtistRuntimeCacheByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const result = await warmCategoryArtistRuntimeCacheByGenre("Thrash & Power Metal");

    expect(result).toEqual({ warmed: false, count: 123 });
    const deleteCacheRowsCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM category_artist_runtime_cache WHERE genre_norm = ?"),
    );
    expect(deleteCacheRowsCall).toBeUndefined();
  });

  it("skips warm rebuild writes when runtime cache is fresh but saturated", async () => {
    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return Promise.resolve([{ tableName: "category_artist_runtime_cache" }]);
      }

      if (text.includes("MAX(updated_at) AS newestUpdatedAt") && text.includes("FROM category_artist_runtime_cache")) {
        return Promise.resolve([{ newestUpdatedAt: new Date(), total: 25_000 }]);
      }

      return Promise.resolve([]);
    });

    const { clearGenreCaches, warmCategoryArtistRuntimeCacheByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const result = await warmCategoryArtistRuntimeCacheByGenre("Thrash & Power Metal");

    expect(result).toEqual({ warmed: false, count: 25_000 });

    const heavyAggregationCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("COUNT(*) AS videoCount") && String(sql).includes("GROUP BY v.`parsed_artist_norm`"),
    );
    expect(heavyAggregationCall).toBeUndefined();

    const deleteCacheRowsCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM category_artist_runtime_cache WHERE genre_norm = ?"),
    );
    expect(deleteCacheRowsCall).toBeUndefined();
  });

  it("invalidates category runtime caches without issuing mass stale timestamp updates", async () => {
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, invalidateRuntimeCategoryCaches } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await invalidateRuntimeCategoryCaches();

    const massUpdateCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE category_artist_runtime_cache")
      && String(sql).includes("SET updated_at = DATE_SUB"),
    );
    expect(massUpdateCall).toBeUndefined();
  });

  it("defers warm rebuild writes during elevated runtime SQL pressure", async () => {
    isRuntimeSqlPressureElevatedMock.mockReturnValue(true);

    queryRawUnsafeMock.mockImplementation((sql: unknown) => {
      const text = String(sql);

      if (text.includes("SHOW TABLES LIKE 'category_artist_runtime_cache'")) {
        return Promise.resolve([{ tableName: "category_artist_runtime_cache" }]);
      }

      if (text.includes("MAX(updated_at) AS newestUpdatedAt") && text.includes("FROM category_artist_runtime_cache")) {
        return Promise.resolve([{ newestUpdatedAt: new Date(), total: 111 }]);
      }

      return Promise.resolve([]);
    });

    const { clearGenreCaches, warmCategoryArtistRuntimeCacheByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const result = await warmCategoryArtistRuntimeCacheByGenre("Thrash & Power Metal");

    expect(result).toEqual({ warmed: false, count: 111 });

    const deleteCacheRowsCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM category_artist_runtime_cache WHERE genre_norm = ?"),
    );
    expect(deleteCacheRowsCall).toBeUndefined();
  });
});