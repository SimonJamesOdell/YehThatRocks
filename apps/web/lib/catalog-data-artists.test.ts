import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();
const ensureArtistSearchPrefixIndexMock = vi.fn();
const getArtistColumnMapMock = vi.fn();
const hasArtistStatsProjectionMock = vi.fn();

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
  };
});

describe("findArtistsInDatabase", () => {
  beforeEach(async () => {
    vi.resetModules();
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
