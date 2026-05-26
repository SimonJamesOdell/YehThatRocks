import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Top-level mock setup ──────────────────────────────────────────────────────

const queryRawUnsafeMock = vi.fn();
const queryRawMock = vi.fn();
const getArtistColumnMapMock = vi.fn();
const hasGenreAllColumnMock = vi.fn();
const hasVideoTitleFulltextIndexMock = vi.fn();
const hasVideoGenreColumnMock = vi.fn();
const getVideoArtistNormalizationColumnMock = vi.fn();
const getVideoArtistNormalizationIndexHintClauseMock = vi.fn();

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
    getVideoArtistNormalizationColumn: getVideoArtistNormalizationColumnMock,
    getVideoArtistNormalizationIndexHintClause: getVideoArtistNormalizationIndexHintClauseMock,
  };
});

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

  it("falls back to 6× LIKE when genre_all column does not exist", async () => {
    hasGenreAllColumnMock.mockResolvedValue(false);
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getArtistsByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getArtistsByGenre("Metal");

    expect(queryRawUnsafeMock).toHaveBeenCalled();
    const callArg = String(queryRawUnsafeMock.mock.calls[0][0]);
    // Falls back to 6-column LIKE
    expect(callArg).toContain("genre1 LIKE");
    expect(callArg).toContain("MAX_EXECUTION_TIME");
    expect(callArg).not.toContain("MATCH");
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

  it("uses 6× LIKE fallback when genre_all column does not exist", async () => {
    hasGenreAllColumnMock.mockResolvedValue(false);

    queryRawMock.mockResolvedValue([]);
    queryRawUnsafeMock.mockResolvedValue([]);

    const { clearGenreCaches, getVideosByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    await getVideosByGenre("Metal");

    const genreLookupCall = queryRawUnsafeMock.mock.calls.find(([sql]) =>
      String(sql).includes("artistName"),
    );
    expect(genreLookupCall).toBeDefined();
    const [sql] = genreLookupCall!;
    expect(String(sql)).toContain("genre1");
    expect(String(sql)).toContain("LIKE");
    expect(String(sql)).toContain("MAX_EXECUTION_TIME");
    expect(String(sql)).not.toContain("MATCH");
  });

  it("reuses cached artist genre lookup for repeated requests", async () => {
    hasGenreAllColumnMock.mockResolvedValue(false);

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
    getArtistColumnMapMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    // Default: genre_all and video FT index both available
    hasGenreAllColumnMock.mockResolvedValue(true);
    hasVideoTitleFulltextIndexMock.mockResolvedValue(true);
    hasVideoGenreColumnMock.mockResolvedValue(true);
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
  //   1. $queryRaw: getGenreKeywordVideos → empty
  //   2. $queryRawUnsafe: artist genre lookup (MATCH on genre_all) → empty
  //   3. $queryRaw: getArtistsByGenre internal MATCH → returns 1 artist so we don't early-exit
  //   4. $queryRaw: FULLTEXT video lookup using artist names → empty
  //   5. $queryRawUnsafe: artist normalized name video lookup → empty
  //   6. textMatchedVideos → the call we want to observe
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
    queryRawUnsafeMock.mockResolvedValue([{ total: 123 }]);

    const { clearGenreCaches, getCategoryArtistCountByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const total = await getCategoryArtistCountByGenre("Metal");

    expect(total).toBe(123);
    const [sql] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("UNION");
    expect(sql).toContain("parsed_artist_norm");
    expect(sql).toContain("COUNT(*) AS total");
    expect(sql).not.toContain("COUNT(DISTINCT LOWER(TRIM(COALESCE");
  });

  it("keeps expression DISTINCT fallback when parsed_artist_norm is unavailable", async () => {
    getVideoArtistNormalizationColumnMock.mockResolvedValue(null);
    queryRawUnsafeMock.mockResolvedValue([{ total: 7 }]);

    const { clearGenreCaches, getCategoryArtistCountByGenre } = await import("@/lib/catalog-data-genres");
    clearGenreCaches();

    const total = await getCategoryArtistCountByGenre("Metal");

    expect(total).toBe(7);
    const [sql] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("COUNT(DISTINCT LOWER(TRIM(COALESCE(NULLIF(v.parsedArtist, ''), NULLIF(v.channelTitle, ''))))) AS total");
    expect(sql).not.toContain("UNION");
  });
});

