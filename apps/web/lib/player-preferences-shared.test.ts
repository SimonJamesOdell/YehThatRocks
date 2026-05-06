import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTOPLAY_MIX,
  normalizeAutoplayGenreFilters,
  normalizeAutoplayMix,
  rebalanceAutoplayMix,
} from "@/lib/player-preferences-shared";

describe("player preferences shared helpers", () => {
  it("normalizes invalid mix input to defaults", () => {
    expect(normalizeAutoplayMix(null)).toEqual(DEFAULT_AUTOPLAY_MIX);
    expect(normalizeAutoplayMix({ top100: 0, favourites: 0, newest: 0, random: 0 })).toEqual(DEFAULT_AUTOPLAY_MIX);
  });

  it("rescales and rounds a mix to total 100", () => {
    const normalized = normalizeAutoplayMix({
      top100: 40,
      favourites: 10,
      newest: 10,
      random: 10,
    });

    const sum = normalized.top100 + normalized.favourites + normalized.newest + normalized.random;
    expect(sum).toBe(100);
    expect(normalized.top100).toBeGreaterThan(normalized.favourites);
  });

  it("rebalances other sliders when one value changes", () => {
    const next = rebalanceAutoplayMix(DEFAULT_AUTOPLAY_MIX, "top100", 70);

    expect(next.top100).toBe(70);
    expect(next.favourites + next.newest + next.random).toBe(30);
    expect(next.top100 + next.favourites + next.newest + next.random).toBe(100);
  });

  it("normalizes genre filters to lowercase unique values", () => {
    const filters = normalizeAutoplayGenreFilters(["  Metal ", "metal", "Rock", "", 12]);
    expect(filters).toEqual(["metal", "rock"]);
  });
});
