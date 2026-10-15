import { describe, expect, it } from "vitest";

import type { VideoRecord } from "@/lib/catalog";
import { buildOptimisticVideoFromPendingSelection } from "@/lib/pending-video-selection";

function makeVideo(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: "previous-id",
    title: "Previous Track",
    channelTitle: "Previous Artist",
    genre: "Rock",
    favourited: 0,
    description: "previous description",
    ...overrides,
  };
}

describe("buildOptimisticVideoFromPendingSelection", () => {
  it("builds the optimistic video when the id matches and a title is present", () => {
    const previous = makeVideo();
    const result = buildOptimisticVideoFromPendingSelection(
      {
        id: "abc",
        title: "Track A",
        channelTitle: "Artist A",
        genre: "Metal",
        favourited: 3,
        description: "a description",
      },
      "abc",
      previous,
    );

    expect(result).toEqual({
      ...previous,
      id: "abc",
      title: "Track A",
      channelTitle: "Artist A",
      genre: "Metal",
      favourited: 3,
      description: "a description",
    });
  });

  it("trims the pending title", () => {
    const result = buildOptimisticVideoFromPendingSelection(
      { id: "abc", title: "  Track A  " },
      "abc",
      makeVideo(),
    );

    expect(result?.title).toBe("Track A");
  });

  it("returns null when the pending selection is for a different video id", () => {
    const result = buildOptimisticVideoFromPendingSelection(
      { id: "other-id", title: "Track A" },
      "abc",
      makeVideo(),
    );

    expect(result).toBeNull();
  });

  it("returns null when the pending selection has no title", () => {
    const result = buildOptimisticVideoFromPendingSelection(
      { id: "abc" },
      "abc",
      makeVideo(),
    );

    expect(result).toBeNull();
  });

  it("returns null when the pending selection title is empty", () => {
    const result = buildOptimisticVideoFromPendingSelection(
      { id: "abc", title: "   " },
      "abc",
      makeVideo(),
    );

    expect(result).toBeNull();
  });

  it("never mixes the previous video's title onto the requested id", () => {
    const previous = makeVideo({ id: "fallback", title: "Fallback Track" });

    const result = buildOptimisticVideoFromPendingSelection(
      { id: "abc", title: undefined },
      "abc",
      previous,
    );

    // The regression guard: a selection with an id but no title must not
    // produce a record whose id is the requested id but whose title still
    // belongs to the fallback video.
    expect(result).toBeNull();
  });

  it("falls back to previous fields for optional selection fields", () => {
    const previous = makeVideo({ channelTitle: "Fallback Artist", genre: "Doom", description: "fallback desc" });

    const result = buildOptimisticVideoFromPendingSelection(
      { id: "abc", title: "Track A" },
      "abc",
      previous,
    );

    expect(result).toEqual({
      ...previous,
      id: "abc",
      title: "Track A",
    });
  });
});
