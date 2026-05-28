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
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("Technical Thrash"))).toBe("Thrash & Power Metal");
  });

  it("resolves canonicalized alias outputs to expected top-level buckets", () => {
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("melodic doom"))).toBe("Doom & Sludge");
    expect(resolveTopLevelGenreBucket("melodic doom")).toBe("Doom & Sludge");
    expect(resolveTopLevelGenreBucket("black")).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket("crossover thrash")).toBe("Thrash & Power Metal");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("gothic"))).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket("Britpop")).toBe("Rock & Alternative");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("death"))).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("speed"))).toBe("Thrash & Power Metal");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("power"))).toBe("Thrash & Power Metal");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("melodic death"))).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("progressive"))).toBe("Progressive & Experimental");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("occult"))).toBe("Black and Death Metal");
    expect(resolveTopLevelGenreBucket(canonicalizeGenreLabel("crossover"))).toBe("Thrash & Power Metal");
    expect(resolveTopLevelGenreBucket("gothic metal")).toBe("Nu-metal & Metalcore");
    expect(resolveTopLevelGenreBucket("Gothic Metal")).toBe("Nu-metal & Metalcore");
  });
});