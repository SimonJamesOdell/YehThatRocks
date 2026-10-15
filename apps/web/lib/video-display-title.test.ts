import { describe, expect, it } from "vitest";

import { buildVideoDisplayTitle } from "@/lib/video-display-title";

describe("buildVideoDisplayTitle", () => {
  it("reconstructs the title from artist and track fields", () => {
    expect(
      buildVideoDisplayTitle({
        title: "Release - Fifth Son of Winterdoom",
        parsedArtist: "Release",
        parsedTrack: "Fifth Son of Winterdoom",
      }),
    ).toBe("Release - Fifth Son of Winterdoom");
  });

  it("falls back to the raw title when artist or track is missing", () => {
    expect(
      buildVideoDisplayTitle({
        title: "Release - Fifth Son of Winterdoom",
        parsedArtist: null,
        parsedTrack: "Fifth Son of Winterdoom",
      }),
    ).toBe("Release - Fifth Son of Winterdoom");
  });

  it("falls back to channelTitle for the artist", () => {
    expect(
      buildVideoDisplayTitle({
        title: "Fifth Son of Winterdoom",
        parsedArtist: null,
        parsedTrack: "Fifth Son of Winterdoom",
        channelTitle: "Release",
      }),
    ).toBe("Release - Fifth Son of Winterdoom");
  });

  it("infers artist and track from a plain title when fields are absent", () => {
    expect(
      buildVideoDisplayTitle({
        title: "Metallica - One",
      }),
    ).toBe("Metallica - One");
  });

  it("returns the raw title unchanged when nothing can be inferred", () => {
    expect(
      buildVideoDisplayTitle({
        title: "SomeUnparseableTitle",
      }),
    ).toBe("SomeUnparseableTitle");
  });
});
