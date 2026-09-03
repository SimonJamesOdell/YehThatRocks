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

  it("uses availability-first join query shape for top/newest slices", async () => {
    const seenSql: string[] = [];

    queryRawMock.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ").trim();
      seenSql.push(sql);

      if (sql.includes("COALESCE(t.viewCount, 0) DESC")) {
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

    const topSql = seenSql.find((sql) => sql.includes("COALESCE(t.viewCount, 0) DESC"));
    const newestSql = seenSql.find((sql) => sql.includes("ORDER BY v.created_at DESC, v.id DESC"));

    // Top slice now pulls an index-ordered shortlist first, then re-ranks it
    // with the exact favourite/view ranking so the query can use
    // idx_videos_favourited_viewcount_videoid instead of filesorting the whole
    // available catalog.
    expect(topSql).toContain("FROM videos v");
    expect(topSql).toContain("sv.status = 'available'");
    expect(topSql).toContain("EXISTS (");
    expect(topSql).toContain("ORDER BY v.favourited DESC, v.viewCount DESC, v.videoId DESC");
    expect(topSql).toContain("ORDER BY t.favourited DESC, COALESCE(t.viewCount, 0) DESC, t.videoId ASC");
    expect(topSql).not.toContain("GROUP BY v.id, v.videoId, v.favourited, v.viewCount");
    expect(topSql).not.toContain("FROM site_videos sv FORCE INDEX (idx_site_videos_status_video_id)");
    expect(topSql).not.toContain("SELECT DISTINCT sv.video_id");
    expect(topSql).not.toContain("available_sv");

    expect(newestSql).toContain("FROM site_videos sv FORCE INDEX (idx_site_videos_status_video_id)");
    expect(newestSql).toContain("INNER JOIN videos v ON v.id = sv.video_id");
    expect(newestSql).toContain("sv.status = 'available'");
    expect(newestSql).toContain("GROUP BY v.id, v.videoId, v.created_at");
    expect(newestSql).not.toContain("EXISTS (");
    expect(newestSql).not.toContain("SELECT DISTINCT sv.video_id");
    expect(newestSql).not.toContain("available_sv");
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
