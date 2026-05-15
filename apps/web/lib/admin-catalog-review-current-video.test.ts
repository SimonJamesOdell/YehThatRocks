import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));

describe("fetchCatalogReviewCurrentVideo", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();
  });

  it("returns null when queue is empty", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([]);

    const { fetchCatalogReviewCurrentVideo } = await import("@/lib/admin-catalog-review-current-video");
    const result = await fetchCatalogReviewCurrentVideo();

    expect(result).toBeNull();
    // Only the queue lookup should have been made — no video fetch
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when queue has entry but video is missing from videos table", async () => {
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ video_id: "abc123", enqueued_at: new Date("2025-01-01") }])
      .mockResolvedValueOnce([]); // no matching video

    const { fetchCatalogReviewCurrentVideo } = await import("@/lib/admin-catalog-review-current-video");
    const result = await fetchCatalogReviewCurrentVideo();

    expect(result).toBeNull();
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2);
  });

  it("returns the full video row including duration when watch_history has data", async () => {
    const enqueuedAt = new Date("2025-01-15T08:00:00Z");
    const createdAt = new Date("2024-12-01T00:00:00Z");

    queryRawUnsafeMock
      .mockResolvedValueOnce([{ video_id: "vid001", enqueued_at: enqueuedAt }])
      .mockResolvedValueOnce([{
        id: 42,
        videoId: "vid001",
        title: "Paranoid",
        parsedArtist: "Black Sabbath",
        parsedTrack: "Paranoid",
        channelTitle: "BlackSabbathVEVO",
        durationSec: 172,
        createdAt,
        updatedAt: createdAt,
      }]);

    const { fetchCatalogReviewCurrentVideo } = await import("@/lib/admin-catalog-review-current-video");
    const result = await fetchCatalogReviewCurrentVideo();

    expect(result).not.toBeNull();
    expect(result!.id).toBe(42);
    expect(result!.videoId).toBe("vid001");
    expect(result!.title).toBe("Paranoid");
    expect(result!.parsedArtist).toBe("Black Sabbath");
    expect(result!.channelTitle).toBe("BlackSabbathVEVO");
    expect(result!.durationSec).toBe(172);
    expect(result!.createdAt).toBe(createdAt);
    expect(result!.enqueuedAt).toBe(enqueuedAt);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2);
  });

  it("returns video row with null durationSec when no watch_history data", async () => {
    const enqueuedAt = new Date("2025-02-01T00:00:00Z");

    queryRawUnsafeMock
      .mockResolvedValueOnce([{ video_id: "vid002", enqueued_at: enqueuedAt }])
      .mockResolvedValueOnce([{
        id: 99,
        videoId: "vid002",
        title: "Unknown Track",
        parsedArtist: null,
        parsedTrack: null,
        channelTitle: null,
        durationSec: null,
        createdAt: null,
        updatedAt: null,
      }]);

    const { fetchCatalogReviewCurrentVideo } = await import("@/lib/admin-catalog-review-current-video");
    const result = await fetchCatalogReviewCurrentVideo();

    expect(result).not.toBeNull();
    expect(result!.durationSec).toBeNull();
    expect(result!.parsedArtist).toBeNull();
    expect(result!.updatedAt).toBeNull();
    expect(result!.enqueuedAt).toBe(enqueuedAt);
  });

  it("passes the queue video_id as both parameters to the video lookup query", async () => {
    const enqueuedAt = new Date("2025-03-01");

    queryRawUnsafeMock
      .mockResolvedValueOnce([{ video_id: "zABCxyz789", enqueued_at: enqueuedAt }])
      .mockResolvedValueOnce([{
        id: 7,
        videoId: "zABCxyz789",
        title: "Some Title",
        parsedArtist: "Artist",
        parsedTrack: null,
        channelTitle: "Ch",
        durationSec: 300,
        createdAt: null,
        updatedAt: null,
      }]);

    const { fetchCatalogReviewCurrentVideo } = await import("@/lib/admin-catalog-review-current-video");
    await fetchCatalogReviewCurrentVideo();

    // Second call: param[0] is the SQL, param[1] is for the correlated subquery, param[2] is for WHERE
    const secondCallArgs = queryRawUnsafeMock.mock.calls[1];
    expect(secondCallArgs[1]).toBe("zABCxyz789");
    expect(secondCallArgs[2]).toBe("zABCxyz789");
  });

  it("uses two DB round-trips in total for a non-empty queue", async () => {
    const enqueuedAt = new Date("2025-04-01");

    queryRawUnsafeMock
      .mockResolvedValueOnce([{ video_id: "twotrip", enqueued_at: enqueuedAt }])
      .mockResolvedValueOnce([{
        id: 1,
        videoId: "twotrip",
        title: "T",
        parsedArtist: null,
        parsedTrack: null,
        channelTitle: null,
        durationSec: null,
        createdAt: null,
        updatedAt: null,
      }]);

    const { fetchCatalogReviewCurrentVideo } = await import("@/lib/admin-catalog-review-current-video");
    await fetchCatalogReviewCurrentVideo();

    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2);
  });
});
