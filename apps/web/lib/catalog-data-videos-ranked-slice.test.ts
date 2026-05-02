import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $queryRawUnsafe: vi.fn(),
  },
}));

describe("catalog-data ranked video ID slices", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawMock.mockReset();
    process.env.DATABASE_URL = "mysql://test:test@localhost:3306/yeh";
  });

  it("uses indexed availability join query shape for top/newest slices", async () => {
    const seenSql: string[] = [];

    queryRawMock.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ").trim();
      seenSql.push(sql);

      if (sql.includes("ORDER BY COALESCE(v.favourited, 0) DESC")) {
        return Promise.resolve([
          { videoId: "ABCDEFGHIJK" },
          { videoId: "ABCDEFGHIJK" },
          { videoId: "ZZZZZZZZZZZ" },
        ]);
      }

      if (sql.includes("ORDER BY v.created_at DESC, v.id DESC")) {
        return Promise.resolve([
          { videoId: "LMNOPQRSTUV" },
          { videoId: "LMNOPQRSTUV" },
          { videoId: "YYYYYYYYYYY" },
        ]);
      }

      return Promise.resolve([]);
    });

    const { clearVideosCaches, getArtistRouteSourceVideoIds } = await import("@/lib/catalog-data-videos");
    clearVideosCaches();

    const result = await getArtistRouteSourceVideoIds(["ABCDEFGHIJK", "LMNOPQRSTUV"], {
      topCount: 2,
      newestCount: 2,
    });

    expect(Array.from(result.topVideoIds)).toEqual(["ABCDEFGHIJK"]);
    expect(Array.from(result.newestVideoIds)).toEqual(["LMNOPQRSTUV"]);

    const topSql = seenSql.find((sql) => sql.includes("ORDER BY COALESCE(v.favourited, 0) DESC"));
    const newestSql = seenSql.find((sql) => sql.includes("ORDER BY v.created_at DESC, v.id DESC"));

    expect(topSql).toContain("INNER JOIN (");
    expect(topSql).toContain("FORCE INDEX (idx_site_videos_status_video_id)");
    expect(topSql).toContain("available_sv.video_id = v.id");

    expect(newestSql).toContain("FORCE INDEX (idx_videos_created_at_id)");
    expect(newestSql).toContain("INNER JOIN (");
    expect(newestSql).toContain("FORCE INDEX (idx_site_videos_status_video_id)");
    expect(newestSql).toContain("available_sv.video_id = v.id");
  });

  it("reuses ranked slice cache on repeated calls", async () => {
    queryRawMock.mockResolvedValue([{ videoId: "ABCDEFGHIJK" }, { videoId: "LMNOPQRSTUV" }]);

    const { clearVideosCaches, getArtistRouteSourceVideoIds } = await import("@/lib/catalog-data-videos");
    clearVideosCaches();

    await getArtistRouteSourceVideoIds(["ABCDEFGHIJK", "LMNOPQRSTUV"], {
      topCount: 2,
      newestCount: 2,
    });

    await getArtistRouteSourceVideoIds(["ABCDEFGHIJK", "LMNOPQRSTUV"], {
      topCount: 2,
      newestCount: 2,
    });

    // First call: top + newest queries. Second call should be fully cache-served.
    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });
});
