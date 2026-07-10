import { describe, expect, it } from "vitest";

import { buildActivityMessage, buildSharedVideoMessage, parseActivityMessage, parseSharedVideoMessage } from "@/lib/chat-shared-video";

describe("chat activity messages", () => {
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

describe("shared video messages", () => {
  it("builds and parses a full payload", () => {
    const content = buildSharedVideoMessage("dQw4w9WgXcQ", "Metallica - Enter Sandman", "Metallica");

    expect(parseSharedVideoMessage(content)).toEqual({
      videoId: "dQw4w9WgXcQ",
      title: "Metallica - Enter Sandman",
      channelTitle: "Metallica",
    });
  });

  it("handles missing optional fields", () => {
    const videoOnly = buildSharedVideoMessage("dQw4w9WgXcQ");
    expect(parseSharedVideoMessage(videoOnly)).toEqual({
      videoId: "dQw4w9WgXcQ",
      title: undefined,
      channelTitle: undefined,
    });

    const videoAndTitle = buildSharedVideoMessage("dQw4w9WgXcQ", "Track Name");
    expect(parseSharedVideoMessage(videoAndTitle)).toEqual({
      videoId: "dQw4w9WgXcQ",
      title: "Track Name",
      channelTitle: undefined,
    });
  });

  it("rejects invalid video IDs", () => {
    expect(buildSharedVideoMessage("short")).toBe("");
    expect(buildSharedVideoMessage("")).toBe("");
    expect(parseSharedVideoMessage("__YTR_SHARE_VIDEO__:bad\tTitle\tArtist")).toBeNull();
    expect(parseSharedVideoMessage("plain text message")).toBeNull();
  });

  it("sanitizes tabs and newlines from fields", () => {
    const content = buildSharedVideoMessage("dQw4w9WgXcQ", "Title\twith\ttabs", "Artist\r\nwith\nnewlines");
    const parsed = parseSharedVideoMessage(content);

    expect(parsed?.title).toBe("Title with tabs");
    expect(parsed?.channelTitle).toBe("Artist with newlines");
  });

  it("truncates long fields", () => {
    const longTitle = "A".repeat(200);
    const longChannel = "B".repeat(150);
    const content = buildSharedVideoMessage("dQw4w9WgXcQ", longTitle, longChannel);
    const parsed = parseSharedVideoMessage(content);

    expect(parsed?.title?.length).toBeLessThanOrEqual(180);
    expect(parsed?.channelTitle?.length).toBeLessThanOrEqual(120);
  });
});
