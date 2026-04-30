import { describe, expect, it } from "vitest";

import { normalizePrismaQueryFingerprint } from "@/lib/query-fingerprint";

describe("normalizePrismaQueryFingerprint", () => {
  it("normalizes literals and whitespace for selects", () => {
    expect(normalizePrismaQueryFingerprint(`
      select * from videos
      where id = 123 and title = 'Black Sabbath'
    `)).toBe("SELECT * FROM VIDEOS WHERE ID = ? AND TITLE = ?");
  });

  it("collapses IN placeholder lists", () => {
    expect(normalizePrismaQueryFingerprint("SELECT * FROM videos WHERE id IN (?, ?, ?, ?)")).toBe(
      "SELECT * FROM VIDEOS WHERE ID IN (?)",
    );
  });

  it("collapses multi-row VALUES clauses", () => {
    expect(normalizePrismaQueryFingerprint("INSERT INTO favourites (userid, videoId) VALUES (?, ?), (?, ?), (?, ?)")).toBe(
      "INSERT INTO FAVOURITES (USERID, VIDEOID) VALUES (...)",
    );
  });

  it("removes comments and caps long fingerprints", () => {
    const fingerprint = normalizePrismaQueryFingerprint(`/* trace */ SELECT ${"very_long_column, ".repeat(20)}id FROM videos -- end`);
    expect(fingerprint.startsWith("SELECT VERY_LONG_COLUMN")).toBe(true);
    expect(fingerprint.endsWith("...")).toBe(true);
    expect(fingerprint.length).toBeLessThanOrEqual(180);
  });

  it("returns SQL.UNKNOWN for empty queries", () => {
    expect(normalizePrismaQueryFingerprint("   ")).toBe("SQL.UNKNOWN");
  });
});
