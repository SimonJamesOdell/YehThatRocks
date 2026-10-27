import { describe, expect, it } from "vitest";

import {
  DECOY_VIDEO_ID_LENGTH,
  buildDecoyArtist,
  buildDecoyCatalogDump,
  decoySlugFor,
  decoyVideoId,
  decoyVideoMetadata,
  isDecoyVideoId,
} from "./decoy-artists";

describe("decoy video IDs", () => {
  it("marks manufactured IDs as decoys", () => {
    const id = decoyVideoId("seed", 3);
    expect(isDecoyVideoId(id)).toBe(true);
    expect(id).toHaveLength(DECOY_VIDEO_ID_LENGTH);
  });

  it("does not flag ordinary IDs", () => {
    expect(isDecoyVideoId("dQw4w9WgXcQ")).toBe(false);
    expect(isDecoyVideoId("")).toBe(false);
    expect(isDecoyVideoId(null)).toBe(false);
    expect(isDecoyVideoId(undefined)).toBe(false);
  });

  it("is deterministic", () => {
    expect(decoyVideoId("seed", 3)).toBe(decoyVideoId("seed", 3));
  });

  it("produces distinct IDs for different seeds", () => {
    expect(decoyVideoId("a", 0)).not.toBe(decoyVideoId("b", 0));
  });
});

describe("decoy slugs and artists", () => {
  it("produces plausible slugs without a machine-readable marker", () => {
    const slug = decoySlugFor("A", 0);
    expect(slug).not.toContain("decoy");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("is deterministic per (letter, index)", () => {
    expect(decoySlugFor("Z", 42)).toBe(decoySlugFor("Z", 42));
    expect(decoySlugFor("A", 0)).not.toBe(decoySlugFor("A", 1));
  });

  it("builds a full artist record with fake video IDs", () => {
    const artist = buildDecoyArtist(decoySlugFor("B", 5));
    expect(artist.slug).toMatch(/^[a-z0-9-]+$/);
    expect(artist.name.length).toBeGreaterThan(0);
    expect(artist.genre.length).toBeGreaterThan(0);
    expect(artist.country.length).toBeGreaterThan(0);
    expect(artist.videoIds.length).toBeGreaterThan(0);
    for (const id of artist.videoIds) {
      expect(isDecoyVideoId(id)).toBe(true);
    }
    expect(isDecoyVideoId(artist.thumbnailVideoId)).toBe(true);
  });

  it("generates metadata for manufactured video IDs", () => {
    const meta = decoyVideoMetadata(decoyVideoId("meta", 1));
    expect(meta.id).toHaveLength(DECOY_VIDEO_ID_LENGTH);
    expect(meta.title).toContain("—");
    expect(meta.channelTitle.length).toBeGreaterThan(0);
  });
});

describe("buildDecoyCatalogDump", () => {
  it("returns a JSON array of the requested rough size", () => {
    const dump = buildDecoyCatalogDump(16_000);
    const parsed = JSON.parse(dump) as Array<{ slug: string; videoIds: string[] }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(dump.length).toBeGreaterThanOrEqual(15_000);
    for (const entry of parsed.slice(0, 5)) {
      expect(entry.slug).toMatch(/^[a-z0-9-]+$/);
      expect(entry.videoIds.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    expect(buildDecoyCatalogDump(4_000)).toBe(buildDecoyCatalogDump(4_000));
  });
});
