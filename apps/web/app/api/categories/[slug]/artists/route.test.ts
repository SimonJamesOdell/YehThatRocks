import { beforeEach, describe, expect, it, vi } from "vitest";

const getArtistsByGenreMock = vi.fn();
const getCategoryArtistsByGenreMock = vi.fn();
const getCategoryArtistTabCountsByGenreMock = vi.fn();
const getGenreBySlugMock = vi.fn();
const warmCategoryArtistRuntimeCacheByGenreMock = vi.fn();

vi.mock("@/lib/catalog-data", () => ({
  getArtistsByGenre: getArtistsByGenreMock,
  getCategoryArtistTabCountsByGenre: getCategoryArtistTabCountsByGenreMock,
  getCategoryArtistsByGenre: getCategoryArtistsByGenreMock,
  getGenreBySlug: getGenreBySlugMock,
  warmCategoryArtistRuntimeCacheByGenre: warmCategoryArtistRuntimeCacheByGenreMock,
}));

function createRequest(query = "") {
  return {
    nextUrl: new URL(`https://test.local/api/categories/thrash-power-metal/artists${query}`),
  };
}

function createArtist(name: string, dominantGenre = "thrash metal") {
  return {
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    videoCount: 5,
    thumbnailVideoId: "AAAAAAAAAAA",
    dominantGenre,
  };
}

describe("GET /api/categories/[slug]/artists", () => {
  beforeEach(() => {
    vi.resetModules();
    getArtistsByGenreMock.mockReset();
    getCategoryArtistsByGenreMock.mockReset();
    getCategoryArtistTabCountsByGenreMock.mockReset();
    getGenreBySlugMock.mockReset();
    warmCategoryArtistRuntimeCacheByGenreMock.mockReset();

    getGenreBySlugMock.mockResolvedValue("Thrash & Power Metal");
    getArtistsByGenreMock.mockResolvedValue([]);
    getCategoryArtistTabCountsByGenreMock.mockResolvedValue({ all: 0 });
    warmCategoryArtistRuntimeCacheByGenreMock.mockResolvedValue({ warmed: true, count: 0 });
  });

  it("uses runtime-cache-enabled category query for full payload by default", async () => {
    getCategoryArtistsByGenreMock.mockResolvedValue([
      createArtist("Metallica"),
      createArtist("Megadeth"),
      createArtist("Anthrax"),
    ]);

    const { GET } = await import("@/app/api/categories/[slug]/artists/route");
    const response = await GET(
      createRequest("?full=1&offset=0&limit=2") as never,
      { params: Promise.resolve({ slug: "thrash-power-metal" }) },
    );
    const payload = await response.json();

    expect(getCategoryArtistsByGenreMock).toHaveBeenCalledWith("Thrash & Power Metal", {
      offset: 0,
      limit: 3,
      maxLimit: 25001,
      bypassRuntimeCache: false,
    });
    expect(getCategoryArtistTabCountsByGenreMock).not.toHaveBeenCalled();
    expect(warmCategoryArtistRuntimeCacheByGenreMock).not.toHaveBeenCalled();

    expect(payload.artists).toHaveLength(2);
    expect(payload.hasMore).toBe(true);
    expect(payload.totalArtists).toBe(2);
    expect(payload.nextOffset).toBe(2);
  });

  it("bypasses runtime cache for explicit full payload warm requests", async () => {
    getCategoryArtistsByGenreMock.mockResolvedValue([
      createArtist("Metallica"),
      createArtist("Megadeth"),
      createArtist("Anthrax"),
    ]);

    const { GET } = await import("@/app/api/categories/[slug]/artists/route");
    await GET(
      createRequest("?full=1&warm=1&offset=0&limit=2") as never,
      { params: Promise.resolve({ slug: "thrash-power-metal" }) },
    );

    expect(warmCategoryArtistRuntimeCacheByGenreMock).toHaveBeenCalledWith("Thrash & Power Metal");
    expect(getCategoryArtistsByGenreMock).toHaveBeenCalledWith("Thrash & Power Metal", {
      offset: 0,
      limit: 3,
      maxLimit: 25001,
      bypassRuntimeCache: true,
    });
  });

  it("still fetches tab counts when includeTabCounts is requested on page one", async () => {
    getCategoryArtistsByGenreMock.mockResolvedValue([
      createArtist("Metallica", "thrash"),
      createArtist("Megadeth", "power"),
      createArtist("Anthrax", "thrash"),
    ]);
    getCategoryArtistTabCountsByGenreMock.mockResolvedValue({
      all: 10,
      thrash: 7,
      "power-speed": 3,
    });

    const { GET } = await import("@/app/api/categories/[slug]/artists/route");
    const response = await GET(
      createRequest("?full=1&includeTabCounts=1&offset=0&limit=2") as never,
      { params: Promise.resolve({ slug: "thrash-power-metal" }) },
    );
    const payload = await response.json();

    expect(getCategoryArtistTabCountsByGenreMock).toHaveBeenCalledWith("Thrash & Power Metal");
    expect(payload.tabCounts).toEqual({ all: 10, thrash: 7, "power-speed": 3 });
    expect(payload.totalArtists).toBe(10);
  });
});
