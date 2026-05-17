import { describe, expect, it } from "vitest";

import { mergePendingQueuePreservingCurrentOrder } from "@/components/admin-pending-queue-order";

describe("mergePendingQueuePreservingCurrentOrder", () => {
  it("keeps the current review order and appends newly arrived items", () => {
    const currentQueue = [
      { id: 10, videoId: "current-review" },
      { id: 11, videoId: "next-review" },
    ];
    const nextQueue = [
      { id: 99, videoId: "newly-arrived" },
      { id: 10, videoId: "current-review" },
      { id: 11, videoId: "next-review" },
    ];

    const merged = mergePendingQueuePreservingCurrentOrder(currentQueue, nextQueue);

    expect(merged.map((item) => item.id)).toEqual([10, 11, 99]);
  });

  it("drops removed videos while preserving order for remaining items", () => {
    const currentQueue = [
      { id: 10, videoId: "current-review" },
      { id: 11, videoId: "removed" },
      { id: 12, videoId: "stays" },
    ];
    const nextQueue = [
      { id: 10, videoId: "current-review" },
      { id: 12, videoId: "stays" },
    ];

    const merged = mergePendingQueuePreservingCurrentOrder(currentQueue, nextQueue);

    expect(merged.map((item) => item.id)).toEqual([10, 12]);
  });

  it("returns server order on first load when there is no current queue", () => {
    const nextQueue = [
      { id: 3, videoId: "third" },
      { id: 1, videoId: "first" },
    ];

    const merged = mergePendingQueuePreservingCurrentOrder([], nextQueue);

    expect(merged).toEqual(nextQueue);
  });
});