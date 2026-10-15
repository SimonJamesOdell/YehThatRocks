import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

import { buildVideoByIdOrderByClause } from "@/lib/catalog-data-db";

describe("buildVideoByIdOrderByClause", () => {
  it("always orders by approved first (single source of truth for duplicate videoId rows)", () => {
    const sql = buildVideoByIdOrderByClause(false);
    const compact = sql.replace(/\s+/g, " ").trim();

    expect(compact).toContain("COALESCE(v.approved, 0) DESC");
    expect(compact).toContain("v.updated_at DESC, v.id DESC");
  });

  it("keeps parsed-artist preference after the approved-first ordering", () => {
    const sql = buildVideoByIdOrderByClause(true);
    const compact = sql.replace(/\s+/g, " ").trim();

    expect(compact).toContain("COALESCE(v.approved, 0) DESC");
    expect(compact).toContain("WHEN v.parsedArtist IS NULL OR TRIM(v.parsedArtist) = '' THEN 1");
    expect(compact).toContain("v.updated_at DESC, v.id DESC");

    // Approved must be the first sort key so the relaxed (includeUnapproved)
    // lookup path still resolves the same row as the metadata path.
    const approvedIndex = compact.indexOf("COALESCE(v.approved, 0) DESC");
    const parsedArtistIndex = compact.indexOf("WHEN v.parsedArtist IS NULL");
    expect(approvedIndex).toBeGreaterThanOrEqual(0);
    expect(parsedArtistIndex).toBeGreaterThan(approvedIndex);
  });
});
