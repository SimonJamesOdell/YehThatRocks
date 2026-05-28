import { describe, expect, it } from "vitest";

import { buildActivityMessage, parseActivityMessage } from "@/lib/chat-shared-video";

describe("chat activity messages", () => {
  it("builds and parses online activity", () => {
    const content = buildActivityMessage("online");

    expect(parseActivityMessage(content)).toEqual({
      action: "online",
      title: undefined,
      channelTitle: undefined,
    });
  });

  it("builds and parses offline activity", () => {
    const content = buildActivityMessage("offline");

    expect(parseActivityMessage(content)).toEqual({
      action: "offline",
      title: undefined,
      channelTitle: undefined,
    });
  });

  it("builds and parses rich activity payloads", () => {
    const content = buildActivityMessage("playing", "dQw4w9WgXcQ", "Track", "Channel");

    expect(parseActivityMessage(content)).toEqual({
      action: "playing",
      videoId: "dQw4w9WgXcQ",
      title: "Track",
      channelTitle: "Channel",
    });
  });
});