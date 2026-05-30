import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();
const findArtistsInDatabaseMock = vi.fn();
const findArtistsFromVideoMetadataMock = vi.fn();
const getGenresMock = vi.fn();
const getSearchRankingSignalsMock = vi.fn();
const originalDatabaseUrl = process.env.DATABASE_URL;

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

vi.mock("@/lib/catalog-data-artists", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalog-data-artists")>("@/lib/catalog-data-artists");
  return {
    ...actual,
    findArtistsInDatabase: findArtistsInDatabaseMock,
    findArtistsFromVideoMetadata: findArtistsFromVideoMetadataMock,
    getArtists: vi.fn(),
    getArtistVideoPoolByNormalizedName: vi.fn(),
    getSameGenreRelatedPoolByArtist: vi.fn(),
  };
});

vi.mock("@/lib/catalog-data-genres", () => ({
  getGenres: getGenresMock,
}));

vi.mock("@/lib/search-flag-data", () => ({
  getSearchRankingSignals: getSearchRankingSignalsMock,
}));

describe("searchCatalog artist search strategy", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "mysql://test";
    queryRawMock.mockReset();
    findArtistsInDatabaseMock.mockReset();
    findArtistsFromVideoMetadataMock.mockReset();
    getGenresMock.mockReset();
    getSearchRankingSignalsMock.mockReset();

    queryRawMock.mockResolvedValue([]);
    findArtistsInDatabaseMock.mockResolvedValue([]);
    findArtistsFromVideoMetadataMock.mockResolvedValue([]);
    getGenresMock.mockResolvedValue([]);
    getSearchRankingSignalsMock.mockResolvedValue({
      suppressedVideoIds: new Set<string>(),
      penaltyByVideoId: new Map<string, number>(),
    });
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
      return;
    }

    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("uses prefix-only artist search for short full-search queries", async () => {
    const { searchCatalog } = await import("@/lib/catalog-data-videos");

    await searchCatalog("ab");

    expect(findArtistsInDatabaseMock).toHaveBeenCalledWith({
      limit: 12,
      search: "ab",
      prefixOnly: true,
      nameOnly: true,
    });
  });

  it("keeps broader artist search semantics for longer full-search queries", async () => {
    const { searchCatalog } = await import("@/lib/catalog-data-videos");

    await searchCatalog("metal");

    expect(findArtistsInDatabaseMock).toHaveBeenCalledWith({
      limit: 12,
      search: "metal",
      prefixOnly: false,
      nameOnly: false,
    });
  });
});
