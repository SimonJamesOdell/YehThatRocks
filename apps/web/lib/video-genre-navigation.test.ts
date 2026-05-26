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

  it("falls back to Rock & Alternative for generic fallback genre labels", () => {
    const target = resolveVideoGenreNavigationTarget("Rock / Metal");
    expect(target.categoryLabel).toBe("Rock & Alternative");
    expect(target.tabId).toBe("other-rock");
    expect(target.href).toBe("/categories/rock-alternative?tab=other-rock");
  });
});
