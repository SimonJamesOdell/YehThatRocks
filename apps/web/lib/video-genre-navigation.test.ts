import { describe, expect, it } from "vitest";

import { resolveVideoGenreNavigationTarget } from "@/lib/video-genre-navigation";

describe("resolveVideoGenreNavigationTarget", () => {
  it("maps specific subgenres to category and matching tab", () => {
    const target = resolveVideoGenreNavigationTarget("thrash metal");
    expect(target.label).toBe("thrash metal");
    expect(target.categoryLabel).toBe("Thrash & Power Metal");
    expect(target.categorySlug).toBe("thrash-power-metal");
    expect(target.tabId).toBe("thrash");
    expect(target.href).toBe("/categories/thrash-power-metal?tab=thrash");
  });

  it("routes broad category labels to category root tab", () => {
    const target = resolveVideoGenreNavigationTarget("Doom & Sludge");
    expect(target.categoryLabel).toBe("Doom & Sludge");
    expect(target.tabId).toBe("doom");
    expect(target.href).toBe("/categories/doom-sludge?tab=doom");
  });

  it("routes the Rock / Metal catch-all bucket to its own category", () => {
    const target = resolveVideoGenreNavigationTarget("Rock / Metal");
    expect(target.label).toBe("Rock / Metal");
    expect(target.categoryLabel).toBe("Rock / Metal");
    expect(target.categorySlug).toBe("rock-metal");
    expect(target.tabId).toBe("all");
    expect(target.href).toBe("/categories/rock-metal");
  });

  it("falls back to Rock & Alternative for genres outside the bucket system", () => {
    const target = resolveVideoGenreNavigationTarget("Pop");
    expect(target.label).toBe("Pop");
    expect(target.categoryLabel).toBe("Rock & Alternative");
    expect(target.categorySlug).toBe("rock-alternative");
    expect(target.tabId).toBe("all");
    expect(target.href).toBe("/categories/rock-alternative");
  });
});
