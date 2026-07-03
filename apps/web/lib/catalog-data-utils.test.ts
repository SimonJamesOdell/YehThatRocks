import { describe, expect, it } from "vitest";

import { getGenreSlug, mapVideo, slugify } from "@/lib/catalog-data-utils";

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

describe("slugify", () => {
  it("lowercases input", () => {
    expect(slugify("Metal")).toBe("metal");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("Thrash Metal")).toBe("thrash-metal");
  });

  it("replaces multiple consecutive spaces with a single hyphen", () => {
    expect(slugify("Power   Metal")).toBe("power-metal");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Rock & Roll")).toBe("rock-roll");
    expect(slugify("Psychedelic/Stoner Rock")).toBe("psychedelic-stoner-rock");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify(" -Metal- ")).toBe("metal");
  });

  it("preserves digits", () => {
    expect(slugify("80s Rock")).toBe("80s-rock");
    expect(slugify("Top 100")).toBe("top-100");
  });

  it("handles mixed case, special chars, and whitespace together", () => {
    expect(slugify("  Thrash & Power Metal!  ")).toBe("thrash-power-metal");
  });

  it("returns empty string for input with no alphanumeric chars", () => {
    expect(slugify(" &!@# ")).toBe("");
  });

  it("handles real genre names correctly", () => {
    expect(slugify("Thrash & Power Metal")).toBe("thrash-power-metal");
    expect(slugify("Progressive Metal")).toBe("progressive-metal");
    expect(slugify("Death Metal")).toBe("death-metal");
    expect(slugify("Stoner/Doom")).toBe("stoner-doom");
    expect(slugify("Hard Rock")).toBe("hard-rock");
  });
});

describe("getGenreSlug", () => {
  it("delegates to slugify with the same output", () => {
    expect(getGenreSlug("Thrash & Power Metal")).toBe("thrash-power-metal");
    expect(getGenreSlug("Progressive Metal")).toBe("progressive-metal");
    expect(getGenreSlug("Death Metal")).toBe("death-metal");
  });

  it("produces URL-safe slugs consistently with slugify", () => {
    const genres = [
      "Heavy Metal",
      "Thrash & Power Metal",
      "Psychedelic/Stoner Rock",
      "Nu Metal",
      "80s Hard Rock",
    ];
    for (const genre of genres) {
      expect(getGenreSlug(genre)).toBe(slugify(genre));
    }
  });
});
