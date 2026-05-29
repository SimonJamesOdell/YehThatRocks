import { describe, expect, it } from "vitest";

import {
  buildSitemapIndex,
  buildSitemapUrlSet,
  getVideoSitemapEntries,
  parseSitemapShardId,
} from "@/lib/sitemap-data";

describe("sitemap XML helpers", () => {
  it("parses numeric shard ids from xml routes", () => {
    expect(parseSitemapShardId("0")).toBe(0);
    expect(parseSitemapShardId("4.xml")).toBe(4);
    expect(parseSitemapShardId("video")).toBeNull();
    expect(parseSitemapShardId("-1")).toBeNull();
  });

  it("builds a valid sitemap index", () => {
    const xml = buildSitemapIndex([0, 1, 2]);

    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://yehthatrocks.com/sitemap/0.xml</loc>");
    expect(xml).toContain("<loc>https://yehthatrocks.com/sitemap/2.xml</loc>");
  });

  it("builds URL sets with escaped video query URLs", () => {
    const xml = buildSitemapUrlSet([
      {
        loc: "https://yehthatrocks.com/?v=dQw4w9WgXcQ&from=test",
        lastmod: "2026-05-29T00:00:00.000Z",
        changefreq: "monthly",
        priority: 0.7,
      },
    ]);

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://yehthatrocks.com/?v=dQw4w9WgXcQ&amp;from=test</loc>");
    expect(xml).toContain("<lastmod>2026-05-29T00:00:00.000Z</lastmod>");
    expect(xml).toContain("<priority>0.7</priority>");
  });

  it("falls back to catalog video query URLs when no database is configured", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const entries = await getVideoSitemapEntries(1);

      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]?.loc).toMatch(/^https:\/\/yehthatrocks\.com\/\?v=[A-Za-z0-9_-]{11}$/);
      expect(entries.some((entry) => entry.loc.includes("/?v="))).toBe(true);
    } finally {
      if (originalDatabaseUrl) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });
});