import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();

vi.mock("@/lib/catalog", () => ({
  videos: [{ id: "ABCDEFGHIJK" }],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

vi.mock("@/lib/catalog-data", () => ({
  getArtistSlugsForSitemap: vi.fn().mockResolvedValue([]),
  getGenres: vi.fn().mockResolvedValue([]),
  getGenreSlug: (value: string) => value.toLowerCase().replace(/\s+/g, "-"),
}));

vi.mock("@/lib/catalog-data-db", () => ({
  AVAILABLE_SITE_VIDEOS_JOIN: "INNER JOIN site_videos sv ON sv.video_id = v.id AND sv.status = 'available'",
}));

vi.mock("@/lib/catalog-data-internal-helpers", () => ({
  buildApprovedVideoPredicate: () => "COALESCE(v.approved, 0) = 1",
}));

vi.mock("@/lib/catalog-data-utils", () => ({
  hasDatabaseUrl: () => true,
  normalizeYouTubeVideoId: (value: string | null | undefined) => value,
  withSoftTimeout: async (_label: string, _ms: number, run: () => Promise<unknown>) => run(),
}));

vi.mock("@/lib/magazine-data", () => ({
  getAllPublishedSlugs: vi.fn().mockResolvedValue([]),
}));

describe("sitemap data runtime cache", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();

    const { clearSitemapDataCaches } = await import("@/lib/sitemap-data");
    clearSitemapDataCaches();
  });

  it("caches shard-count query results within the runtime TTL window", async () => {
    queryRawUnsafeMock.mockResolvedValue([{ total: 100001n }]);

    const { getVideoSitemapShardCount } = await import("@/lib/sitemap-data");

    const first = await getVideoSitemapShardCount();
    const second = await getVideoSitemapShardCount();

    expect(first).toBe(3);
    expect(second).toBe(3);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
  });

  it("caches video shard entries per shard id", async () => {
    queryRawUnsafeMock.mockResolvedValue([
      { videoId: "ABCDEFGHIJK", lastModified: "2026-06-08T00:00:00.000Z" },
    ]);

    const { getVideoSitemapEntries } = await import("@/lib/sitemap-data");

    const first = await getVideoSitemapEntries(1);
    const second = await getVideoSitemapEntries(1);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.loc).toContain("/?v=ABCDEFGHIJK");
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
  });

  it("clears cached shard entries when clearSitemapDataCaches is invoked", async () => {
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ videoId: "ABCDEFGHIJK", lastModified: "2026-06-08T00:00:00.000Z" }])
      .mockResolvedValueOnce([{ videoId: "LMNOPQRSTUV", lastModified: "2026-06-08T00:00:00.000Z" }]);

    const { clearSitemapDataCaches, getVideoSitemapEntries } = await import("@/lib/sitemap-data");

    const first = await getVideoSitemapEntries(2);
    clearSitemapDataCaches();
    const second = await getVideoSitemapEntries(2);

    expect(first[0]?.loc).toContain("ABCDEFGHIJK");
    expect(second[0]?.loc).toContain("LMNOPQRSTUV");
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2);
  });
});
