import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeRawMock = vi.fn();
const videoFindManyMock = vi.fn();
const loadTableColumnsMock = vi.fn();
const loadVideoForeignKeyRefsMock = vi.fn();
const clearGenreCardThumbnailForVideoMock = vi.fn();

const originalDatabaseUrl = process.env.DATABASE_URL;

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRawUnsafe: executeRawMock,
    $executeRaw: executeRawMock,
    video: {
      findMany: videoFindManyMock,
    },
  },
}));

vi.mock("@/lib/catalog-data-db", () => ({
  loadTableColumns: loadTableColumnsMock,
  loadVideoForeignKeyRefs: loadVideoForeignKeyRefsMock,
  pickColumn: (
    columns: Array<{ Field: string; Type: string }>,
    names: string[],
  ) => columns.find((column) => names.includes(column.Field)) ?? null,
}));

vi.mock("@/lib/catalog-data-genres", () => ({
  clearGenreCardThumbnailForVideo: clearGenreCardThumbnailForVideoMock,
}));

vi.mock("@/lib/available-video-max-id", () => ({
  markAvailableVideoMaxIdDirty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/catalog-data-artists", () => ({
  scheduleArtistProjectionRefreshForName: vi.fn(),
}));

vi.mock("@/lib/api-usage-telemetry", () => ({
  recordExternalApiUsage: vi.fn(),
}));

type Column = { Field: string; Type: string };

const varcharCol = (field: string): Column[] => [{ Field: field, Type: "varchar(32)" }];

// Mirrors the live schema: string-keyed association tables use videoId/video_id,
// integer-FK tables (site_videos, playlistitems, videosbyartist) use an int id.
const TABLE_COLUMNS: Record<string, Column[]> = {
  site_videos: [{ Field: "video_id", Type: "int" }],
  playlistitems: [{ Field: "video_id", Type: "int" }],
  favourites: [{ Field: "videoId", Type: "varchar(32)" }],
  videosbyartist: [{ Field: "video_id", Type: "int" }],
  messages: [{ Field: "video_id", Type: "varchar(32)" }],
  related: [
    { Field: "videoId", Type: "varchar(32)" },
    { Field: "related", Type: "varchar(32)" },
  ],
  watch_history: varcharCol("video_id"),
  hidden_videos: varcharCol("video_id"),
  analytics_events: varcharCol("video_id"),
  artist_stats: varcharCol("thumbnail_video_id"),
  magazine_articles: varcharCol("video_id"),
  forum_threads: [
    { Field: "video1_id", Type: "varchar(11)" },
    { Field: "video2_id", Type: "varchar(11)" },
  ],
};

describe("pruneVideoAndAssociationsByVideoId coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    executeRawMock.mockReset();
    executeRawMock.mockResolvedValue(1);
    videoFindManyMock.mockReset();
    loadTableColumnsMock.mockReset();
    loadVideoForeignKeyRefsMock.mockReset();
    clearGenreCardThumbnailForVideoMock.mockReset();
    clearGenreCardThumbnailForVideoMock.mockResolvedValue(undefined);
    process.env.DATABASE_URL = "mysql://test";

    videoFindManyMock.mockResolvedValue([{ id: 77, parsedArtist: null }]);
    loadVideoForeignKeyRefsMock.mockResolvedValue([]);
    loadTableColumnsMock.mockImplementation(async (table: string) => TABLE_COLUMNS[table] ?? []);
  });

  it("deletes from every association table and clears reference-column tables", async () => {
    const { pruneVideoAndAssociationsByVideoId } = await import("@/lib/catalog-data-video-ingestion");
    const result = await pruneVideoAndAssociationsByVideoId("abc123def45", "runtime-prune");

    expect(result.pruned).toBe(true);

    const sqlCalls = executeRawMock.mock.calls.map((args) => String(args[0]));
    const allSql = sqlCalls.join("\n");

    // Row-per-video tables must be deleted outright.
    for (const table of [
      "site_videos",
      "playlistitems",
      "favourites",
      "videosbyartist",
      "messages",
      "related",
      "watch_history",
      "hidden_videos",
      "analytics_events",
      "videos",
    ]) {
      expect(allSql, `expected prune to delete from ${table}`).toContain(table);
    }

    // Reference-column tables keep their parent row; the video pointer is cleared.
    for (const table of ["artist_stats", "magazine_articles", "forum_threads"]) {
      expect(allSql, `expected prune to clear ${table}`).toContain(table);
    }

    // genre_cards is cleared via the shared genre helper (already covered above).
    expect(clearGenreCardThumbnailForVideoMock).toHaveBeenCalledWith("abc123def45");
  });
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
});
