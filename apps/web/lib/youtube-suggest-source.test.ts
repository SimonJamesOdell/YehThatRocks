import { describe, expect, it } from "vitest";

import { parseYouTubeSuggestSource } from "@/lib/youtube-suggest-source";

describe("parseYouTubeSuggestSource", () => {
  it("parses watch URLs as video sources", () => {
    const result = parseYouTubeSuggestSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).toEqual({ kind: "video", videoId: "dQw4w9WgXcQ" });
  });

  it("parses playlist URLs", () => {
    const result = parseYouTubeSuggestSource("https://www.youtube.com/playlist?list=PL1234567890_abcd");
    expect(result).toEqual({ kind: "playlist", playlistId: "PL1234567890_abcd" });
  });

  it("parses handle channel URLs", () => {
    const result = parseYouTubeSuggestSource("https://www.youtube.com/@thelordofpowermetal1052/videos");
    expect(result).toEqual({ kind: "channel", channelHandle: "thelordofpowermetal1052" });
  });

  it("parses channel-id URLs", () => {
    const result = parseYouTubeSuggestSource("https://www.youtube.com/channel/UC1234567890ABCDEFGHIJK/videos");
    expect(result).toEqual({ kind: "channel", channelId: "UC1234567890ABCDEFGHIJK" });
  });

  it("parses legacy /user URLs", () => {
    const result = parseYouTubeSuggestSource("https://www.youtube.com/user/ExampleUser/videos");
    expect(result).toEqual({ kind: "channel", channelUsername: "ExampleUser" });
  });

  it("parses legacy /c URLs", () => {
    const result = parseYouTubeSuggestSource("https://www.youtube.com/c/ExampleCustom/videos");
    expect(result).toEqual({ kind: "channel", channelCustomName: "ExampleCustom" });
  });

  it("returns null for unsupported values", () => {
    const result = parseYouTubeSuggestSource("not-a-youtube-source");
    expect(result).toBeNull();
  });
});
