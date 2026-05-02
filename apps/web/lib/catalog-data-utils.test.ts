import { describe, expect, it } from "vitest";

import { mapVideo } from "@/lib/catalog-data-utils";

describe("mapVideo artist selection", () => {
  it("prefers parsedArtist even when title order is reversed", () => {
    const mapped = mapVideo({
      videoId: "ABCDEFGHIJK",
      title: "War Pigs - Black Sabbath",
      channelTitle: "RandomUploader",
      parsedArtist: "Black Sabbath",
      parsedTrack: "War Pigs",
      favourited: 0,
      description: null,
    });

    expect(mapped.channelTitle).toBe("Black Sabbath");
  });

  it("falls back to channelTitle when parsedArtist is missing", () => {
    const mapped = mapVideo({
      videoId: "LMNOPQRSTUV",
      title: "Unknown Song",
      channelTitle: "Known Channel",
      parsedArtist: null,
      parsedTrack: null,
      favourited: 0,
      description: null,
    });

    expect(mapped.channelTitle).toBe("Known Channel");
  });
});
