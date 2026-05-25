import { describe, expect, it } from "vitest";

import {
  canonicalizeGenreLabel,
  resolveTopLevelGenreBucket,
} from "@/lib/genre-buckets";

describe("genre bucket alias mapping", () => {
  it("canonicalizes short admin queue labels to full metal genres", () => {
    expect(canonicalizeGenreLabel("death")).toBe("death metal");
    expect(canonicalizeGenreLabel("speed")).toBe("speed metal");
    expect(canonicalizeGenreLabel("power")).toBe("power metal");
    expect(canonicalizeGenreLabel("melodic death")).toBe("melodic death metal");
    expect(canonicalizeGenreLabel("progressive")).toBe("progressive metal");
    expect(canonicalizeGenreLabel("technical speed")).toBe("technical speed metal");
    expect(canonicalizeGenreLabel("metal")).toBe("heavy metal");
    expect(canonicalizeGenreLabel("occult")).toBe("black metal");
    expect(canonicalizeGenreLabel("crossover")).toBe("crossover thrash");
  });

  it("maps technical thrash to thrash metal for bucket matching", () => {
    expect(canonicalizeGenreLabel("Technical Thrash")).toBe("thrash metal");
    expect(resolveTopLevelGenreBucket("Technical Thrash")).toBe("Thrash & Power Metal");
  });

  it("resolves alias inputs to expected top-level buckets", () => {
    expect(resolveTopLevelGenreBucket("death")).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket("speed")).toBe("Thrash & Power Metal");
    expect(resolveTopLevelGenreBucket("power")).toBe("Thrash & Power Metal");
    expect(resolveTopLevelGenreBucket("melodic death")).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket("progressive")).toBe("Progressive & Experimental");
    expect(resolveTopLevelGenreBucket("occult")).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket("crossover")).toBe("Punk & Hardcore");
  });
});