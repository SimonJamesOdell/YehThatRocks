import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();
const queryRawUnsafeMock = vi.fn();
const hasVideoGenreColumnMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $queryRawUnsafe: queryRawUnsafeMock,
    video: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock("@/lib/catalog-data-db", () => ({
  loadTableColumns: vi.fn(),
  pickColumn: vi.fn(),
  getStoredVideoById: vi.fn(),
  AVAILABLE_SITE_VIDEOS_JOIN: "",
  AVAILABLE_SITE_VIDEOS_EXISTS_CLAUSE: "",
  hasVideoGenreColumn: hasVideoGenreColumnMock,
}));

vi.mock("@/lib/catalog-data-video-ingestion", () => ({
  getVideoPlaybackDecision: vi.fn(),
  maybeStartAutomaticRelatedBackfill: vi.fn(),
  pruneVideoAndAssociationsByVideoId: vi.fn(),
}));

describe("getNewestVideos fast path ordering", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawMock.mockReset();
    queryRawUnsafeMock.mockReset();
    hasVideoGenreColumnMock.mockReset();
    hasVideoGenreColumnMock.mockResolvedValue(true);
    process.env.DATABASE_URL = "mysql://test:test@localhost:3306/yeh";
  });

  it("orders genre-column fast-path candidates by approval/created recency", async () => {
    const seenSql: string[] = [];

    queryRawMock.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ").replace(/\s+/g, " ").trim();
      seenSql.push(sql);

      if (sql.includes("FROM videos v") && sql.includes("LIMIT") && sql.includes("OFFSET")) {
        return Promise.resolve([
          {
            id: 2,
            videoId: "LMNOPQRSTUV",
            title: "Newest 1",
            parsedArtist: "Band A",
            genre: "thrash metal",
            favourited: 0,
            description: "",
          },
          {
            id: 1,
            videoId: "ABCDEFGHIJK",
            title: "Newest 2",
            parsedArtist: "Band B",
            genre: "death metal",
            favourited: 0,
            description: "",
          },
        ]);
      }

      return Promise.resolve([]);
    });

    queryRawUnsafeMock.mockResolvedValue([
      { videoId: 2 },
      { videoId: 1 },
    ]);

    const { clearVideosCaches, getNewestVideos } = await import("@/lib/catalog-data-videos");
    clearVideosCaches();

    const videos = await getNewestVideos(2, 0);

    expect(videos).toHaveLength(2);
    expect(videos.map((video) => video.id)).toEqual(["LMNOPQRSTUV", "ABCDEFGHIJK"]);

    const fastPathSql = seenSql.find((sql) =>
      sql.includes("SELECT v.id, v.videoId") && sql.includes("FROM videos v"),
    );

    expect(fastPathSql).toBeDefined();
    expect(fastPathSql).toContain("ORDER BY COALESCE(v.approved_at, v.created_at) DESC, v.id DESC");
  });
});
