import { describe, expect, it } from "vitest";

import type { VideoRecord } from "@/lib/catalog";
import { mutateTemporaryQueue } from "@/domains/queue/temporary-queue";

function createVideo(id: string): VideoRecord {
  return {
    id,
    title: `title-${id}`,
    channelTitle: "channel",
    genre: "genre",
    favourited: 0,
    description: "desc",
  };
}

describe("temporary queue domain", () => {
  it("adds unique tracks only", () => {
    const queue = [createVideo("v1")];

    expect(mutateTemporaryQueue(queue, { type: "add", track: createVideo("v1") })).toEqual(queue);
    expect(mutateTemporaryQueue(queue, { type: "add", track: createVideo("v2") }).map((video) => video.id)).toEqual(["v1", "v2"]);
  });

  it("removes by video id regardless of reason", () => {
    const queue = [createVideo("v1"), createVideo("v2")];

    expect(mutateTemporaryQueue(queue, { type: "remove", videoId: "v1", reason: "ended" }).map((video) => video.id)).toEqual(["v2"]);
    expect(mutateTemporaryQueue(queue, { type: "remove", videoId: "v2", reason: "manual-next" }).map((video) => video.id)).toEqual(["v1"]);
    expect(mutateTemporaryQueue(queue, { type: "remove", videoId: "v2", reason: "transition-sync" }).map((video) => video.id)).toEqual(["v1"]);
  });

  it("clears queue", () => {
    const queue = [createVideo("v1"), createVideo("v2")];

    expect(mutateTemporaryQueue(queue, { type: "clear" })).toEqual([]);
  });
});
