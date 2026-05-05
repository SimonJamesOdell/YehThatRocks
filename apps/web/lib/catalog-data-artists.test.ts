import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();
const ensureArtistSearchPrefixIndexMock = vi.fn();
const getArtistColumnMapMock = vi.fn();
const hasArtistStatsProjectionMock = vi.fn();
const hasArtistStatsThumbnailColumnMock = vi.fn();
const getVideoArtistNormalizationColumnMock = vi.fn();
const getVideoArtistNormalizationIndexHintClauseMock = vi.fn();
const originalDatabaseUrl = process.env.DATABASE_URL;

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

vi.mock("@/lib/catalog-data-db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog-data-db")>("@/lib/catalog-data-db");
  return {
    ...actual,
    ensureArtistSearchPrefixIndex: ensureArtistSearchPrefixIndexMock,
    getArtistColumnMap: getArtistColumnMapMock,
    hasArtistStatsProjection: hasArtistStatsProjectionMock,
    hasArtistStatsThumbnailColumn: hasArtistStatsThumbnailColumnMock,
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

describe("findArtistsInDatabase", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    ensureArtistSearchPrefixIndexMock.mockReset();
    getArtistColumnMapMock.mockReset();
    hasArtistStatsProjectionMock.mockReset();

    hasArtistStatsProjectionMock.mockResolvedValue(false);
  });

  it("uses normalized prefix path for autocomplete mode", async () => {
    getArtistColumnMapMock.mockResolvedValue({
      name: "artist",
      normalizedName: "artist_name_norm",
      country: "country",
      genreColumns: ["genre1"],
    });
    queryRawUnsafeMock.mockResolvedValue([{ name: "Metallica", country: "US", genre1: "Metal" }]);

    const { clearArtistCaches, findArtistsInDatabase } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await findArtistsInDatabase({
      limit: 4,
      search: "MeTa",
      prefixOnly: true,
      nameOnly: true,
      orderByName: true,
    });

    expect(ensureArtistSearchPrefixIndexMock).toHaveBeenCalledTimes(1);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);

    const [sql, ...params] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("a.`artist_name_norm` LIKE ?");
    expect(sql).toContain("ORDER BY a.`artist` ASC");
    expect(params).toEqual(["meta%"]);
  });

  it("falls back to name LIKE prefix when normalized column is unavailable", async () => {
    getArtistColumnMapMock.mockResolvedValue({
      name: "artist",
      normalizedName: null,
      country: "country",
      genreColumns: ["genre1"],
    });
    queryRawUnsafeMock.mockResolvedValue([{ name: "Megadeth", country: "US", genre1: "Metal" }]);

    const { clearArtistCaches, findArtistsInDatabase } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await findArtistsInDatabase({
      limit: 4,
      search: "Mega",
      prefixOnly: true,
      nameOnly: true,
      orderByName: true,
    });

    expect(ensureArtistSearchPrefixIndexMock).toHaveBeenCalledTimes(1);

    const [sql, ...params] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("a.`artist` LIKE ?");
    expect(params).toEqual(["Mega%"]);
  });

  it("keeps non-prefix search semantics for broader artist lookup", async () => {
    getArtistColumnMapMock.mockResolvedValue({
      name: "artist",
      normalizedName: "artist_name_norm",
      country: "country",
      genreColumns: ["genre1", "genre2"],
    });
    queryRawUnsafeMock.mockResolvedValue([{ name: "Dream Theater", country: "US", genre1: "Progressive Metal" }]);

    const { clearArtistCaches, findArtistsInDatabase } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await findArtistsInDatabase({
      limit: 12,
      search: "metal",
      prefixOnly: false,
      nameOnly: false,
      orderByName: false,
    });

    expect(ensureArtistSearchPrefixIndexMock).not.toHaveBeenCalled();

    const [sql, ...params] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("a.`artist` LIKE ?");
    expect(sql).toContain("a.`country` LIKE ?");
    expect(sql).toContain("a.`genre1` LIKE ?");
    expect(sql).toContain("a.`genre2` LIKE ?");
    expect(params).toEqual(["%metal%", "%metal%", "%metal%", "%metal%"]);
  });
});

describe("getArtistBySlug — narrow query strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    getArtistColumnMapMock.mockReset();
    hasArtistStatsProjectionMock.mockReset();

    hasArtistStatsProjectionMock.mockResolvedValue(false);
    getArtistColumnMapMock.mockResolvedValue({
      name: "artist",
      normalizedName: null,
      country: null,
      genreColumns: ["genre1"],
    });
  });

  it("uses FULLTEXT MATCH AGAINST for slug terms ≥ 3 chars", async () => {
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ name: "Iron Maiden", country: null, genre1: "Heavy Metal" }]);

    const { clearArtistCaches, getArtistBySlug } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    const result = await getArtistBySlug("iron-maiden");

    const [sql, ...params] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("MATCH(a.`artist`) AGAINST(? IN BOOLEAN MODE)");
    expect(sql).not.toContain("LOWER(a.`artist`) LIKE");
    expect(params).toEqual(["+iron* +maiden*"]);
    expect(result?.name).toBe("Iron Maiden");
  });

  it("filters short terms from FULLTEXT query (only uses terms ≥ 3 chars)", async () => {
    // slug "mac-a": term "a" is below ft_min_word_len — only "mac" goes to FULLTEXT
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ name: "Mac A", country: null, genre1: "Rock" }]);

    const { clearArtistCaches, getArtistBySlug } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await getArtistBySlug("mac-a");

    const [sql, ...params] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("MATCH(a.`artist`) AGAINST(? IN BOOLEAN MODE)");
    expect(params).toEqual(["+mac*"]);
  });

  it("falls back to LOWER LIKE when all slug terms are shorter than 3 chars", async () => {
    // slug "ac-dc": both terms are 2 chars — below ft_min_word_len, use LOWER LIKE
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ name: "AC/DC", country: null, genre1: "Rock" }]);

    const { clearArtistCaches, getArtistBySlug } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await getArtistBySlug("ac-dc");

    const [sql, ...params] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("LOWER(a.`artist`) LIKE ?");
    expect(sql).not.toContain("MATCH(a.`artist`)");
    expect(params).toEqual(["%ac%", "%dc%"]);
  });
});

describe("getVideosByArtist — availability check strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    hasArtistStatsProjectionMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();
    getVideoArtistNormalizationIndexHintClauseMock.mockReset();

    hasArtistStatsProjectionMock.mockResolvedValue(false);
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
    getVideoArtistNormalizationIndexHintClauseMock.mockResolvedValue(
      " FORCE INDEX (idx_videos_parsed_artist_norm_fav_view_videoid_id)",
    );
  });

  it("uses EXISTS clause instead of DISTINCT subquery JOIN", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([
      { videoId: "vid001", title: "Heavy Song", parsedArtist: "Iron Maiden", favourited: 10, description: null },
    ]);

    const { clearArtistCaches, getVideosByArtist } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await getVideosByArtist("Iron Maiden");

    const [sql] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("site_videos sv");
    expect(sql).toContain("sv.status = 'available'");
    // Must NOT use the materialising DISTINCT subquery pattern
    expect(sql).not.toContain("SELECT DISTINCT sv.video_id");
    expect(sql).not.toContain("available_sv");
  });

  it("retains FORCE INDEX hint for the parsedArtist_norm index", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([]);

    const { clearArtistCaches, getVideosByArtist } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await getVideosByArtist("Metallica");

    const [sql] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("FORCE INDEX");
  });

  it("returns empty array when no videos match the artist", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([]);

    const { clearArtistCaches, getVideosByArtist } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    const result = await getVideosByArtist("NoSuchArtist");
    expect(result).toEqual([]);
  });

  it("maps returned rows to VideoRecord shape", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([
      { videoId: "abc123", title: "Aces High", parsedArtist: "Iron Maiden", favourited: 42, description: "live" },
    ]);

    const { clearArtistCaches, getVideosByArtist } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    const result = await getVideosByArtist("Iron Maiden");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc123");
    expect(result[0].title).toBe("Aces High");
    expect(result[0].channelTitle).toBe("Iron Maiden");
    expect(result[0].favourited).toBe(42);
  });

  it("deduplicates videos with the same id", async () => {
    // DB returns two rows with the same videoId (shouldn't normally happen, but guard it)
    queryRawUnsafeMock.mockResolvedValueOnce([
      { videoId: "dup001", title: "Song", parsedArtist: "Band", favourited: 1, description: null },
      { videoId: "dup001", title: "Song", parsedArtist: "Band", favourited: 1, description: null },
    ]);

    const { clearArtistCaches, getVideosByArtist } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    const result = await getVideosByArtist("Band");
    expect(result).toHaveLength(1);
  });

  it("uses cached result on second call without DB round-trip", async () => {
    queryRawUnsafeMock.mockResolvedValue([
      { videoId: "v1", title: "Track 1", parsedArtist: "Artist", favourited: 0, description: null },
    ]);

    const { clearArtistCaches, getVideosByArtist } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    await getVideosByArtist("Artist");
    queryRawUnsafeMock.mockReset();
    await getVideosByArtist("Artist");

    // Cache should have served the second request — DB not called again
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("falls back to seed data when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;

    const { clearArtistCaches, getVideosByArtist } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    const result = await getVideosByArtist("Metallica");

    // Seed data returned, no DB calls made
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("getArtistsByLetter — prefix query strategy", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawUnsafeMock.mockReset();
    getArtistColumnMapMock.mockReset();
    hasArtistStatsProjectionMock.mockReset();
    hasArtistStatsThumbnailColumnMock.mockReset();
    getVideoArtistNormalizationColumnMock.mockReset();

    hasArtistStatsThumbnailColumnMock.mockResolvedValue(false);
    getVideoArtistNormalizationColumnMock.mockResolvedValue("parsed_artist_norm");
  });

  it("uses index-friendly prefix LIKE (no LOWER) for artist_stats projection pages", async () => {
    hasArtistStatsProjectionMock.mockResolvedValue(true);

    queryRawUnsafeMock.mockResolvedValueOnce([
      {
        displayName: "Alice In Chains",
        slug: "alice-in-chains",
        country: "US",
        genre: "Grunge",
        videoCount: 42,
        thumbnailVideoId: "abc12345678",
      },
    ]);

    const { clearArtistCaches, getArtistsByLetter } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    const rows = await getArtistsByLetter("A", 60, 0, "a");

    expect(rows.length).toBe(1);
    const [sql, ...params] = queryRawUnsafeMock.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain("s.first_letter = ?");
    expect(sql).toContain("s.display_name LIKE ?");
    expect(sql).not.toContain("LOWER(s.display_name) LIKE ?");
    expect(params).toEqual(["A", "a%"]);
  });

  it("uses index-friendly prefix LIKE (no LOWER) for parsedArtist fallback query", async () => {
    hasArtistStatsProjectionMock.mockResolvedValue(false);
    getArtistColumnMapMock.mockResolvedValue({
      name: "artist",
      normalizedName: null,
      country: null,
      genreColumns: ["genre1"],
    });

    queryRawUnsafeMock
      .mockResolvedValueOnce([{ hasRows: 0 }])
      .mockResolvedValueOnce([{ name: "Alice In Chains", country: null, genre1: "Grunge" }])
      .mockResolvedValueOnce([{ artistKey: "alice in chains", videoCount: 3, thumbnailVideoId: "abc12345678" }]);

    const { clearArtistCaches, getArtistsByLetter } = await import("@/lib/catalog-data-artists");
    clearArtistCaches();

    const rows = await getArtistsByLetter("A", 60, 0, "a");

    expect(rows.length).toBe(1);
    const [artistSql, ...artistParams] = queryRawUnsafeMock.mock.calls[1] as [string, ...unknown[]];
    expect(artistSql).toContain("a.`artist` LIKE ?");
    expect(artistSql).not.toContain("LOWER(TRIM(COALESCE(a.`artist`, ''))) LIKE ?");
    expect(artistParams).toEqual(["a%"]);
  });
});
