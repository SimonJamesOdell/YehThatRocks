import { describe, expect, it, vi } from "vitest";

import type { VideoRecord } from "@/lib/catalog";
import { createFavouriteVideosCache } from "@/lib/favourite-videos-cache";

function makeVideo(id: string): VideoRecord {
  return {
    id,
    title: `title-${id}`,
    channelTitle: "channel",
    genre: "genre",
    favourited: 1,
    description: "desc",
  };
}

describe("favourite videos cache", () => {
  it("returns cloned videos on get", () => {
    const cache = createFavouriteVideosCache(1_000);
    cache.set(42, [makeVideo("v1")]);

    const first = cache.get(42);
    expect(first).toBeDefined();
    expect(first?.[0]?.id).toBe("v1");

    if (first && first[0]) {
      first[0].title = "mutated";
    }

    const second = cache.get(42);
    expect(second?.[0]?.title).toBe("title-v1");
  });

  it("expires entries after ttl", () => {
    vi.useFakeTimers();

    const cache = createFavouriteVideosCache(100);
    cache.set(7, [makeVideo("v1")]);
    expect(cache.get(7)?.length).toBe(1);

    vi.advanceTimersByTime(101);
    expect(cache.get(7)).toBeUndefined();

    vi.useRealTimers();
  });

  it("preserves insertion order", () => {
    const cache = createFavouriteVideosCache(1_000);
    cache.set(9, [makeVideo("v1"), makeVideo("v2")]);

    expect(cache.get(9)?.map((video) => video.id)).toEqual(["v1", "v2"]);
  });

  it("evicts the oldest entry when max entries is exceeded", () => {
    const cache = createFavouriteVideosCache(1_000, { maxEntries: 2 });

    cache.set(1, [makeVideo("a")]);
    cache.set(2, [makeVideo("b")]);
    cache.set(3, [makeVideo("c")]);

    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)?.[0]?.id).toBe("b");
    expect(cache.get(3)?.[0]?.id).toBe("c");
  });
});
