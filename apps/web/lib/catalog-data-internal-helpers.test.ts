import { afterEach, describe, expect, it } from "vitest";

import {
  buildApprovedVideoPredicate,
  getDatabaseNormalizedVideoId,
  getLowerTrimmedDatabaseValue,
  getTrimmedDatabaseValue,
  hasDatabaseUserScope,
  mapPlaylistFallbackRowToDetail,
} from "@/lib/catalog-data-internal-helpers";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("catalog-data internal helpers", () => {
  it("builds approved predicate with and without table alias", () => {
    expect(buildApprovedVideoPredicate()).toBe("COALESCE(approved, 0) = 1");
    expect(buildApprovedVideoPredicate("v")).toBe("COALESCE(v.approved, 0) = 1");
  });

  it("guards DB + user scope checks", () => {
    delete process.env.DATABASE_URL;
    expect(hasDatabaseUserScope(42)).toBe(false);

    process.env.DATABASE_URL = "mysql://example";
    expect(hasDatabaseUserScope(undefined)).toBe(false);
    expect(hasDatabaseUserScope(0)).toBe(false);
    expect(hasDatabaseUserScope(42)).toBe(true);
  });

  it("normalizes trimmed values only when DB is configured", () => {
    delete process.env.DATABASE_URL;
    expect(getTrimmedDatabaseValue(" Black Sabbath ")).toBeNull();
    expect(getLowerTrimmedDatabaseValue(" Black Sabbath ")).toBeNull();

    process.env.DATABASE_URL = "mysql://example";
    expect(getTrimmedDatabaseValue(" Black Sabbath ")).toBe("Black Sabbath");
    expect(getLowerTrimmedDatabaseValue(" Black Sabbath ")).toBe("black sabbath");
  });

  it("maps playlist fallback rows to stable playlist detail shape", () => {
    const detail = mapPlaylistFallbackRowToDetail({ id: 12n, name: null });
    expect(detail).toEqual({
      id: "12",
      name: "Untitled Playlist",
      videos: [],
    });
  });

  it("returns normalized video id only when DB is configured", () => {
    delete process.env.DATABASE_URL;
    expect(getDatabaseNormalizedVideoId("https://youtu.be/ABCDEFGHIJK")).toBeNull();

    process.env.DATABASE_URL = "mysql://example";
    expect(getDatabaseNormalizedVideoId("https://youtu.be/ABCDEFGHIJK")).toBe("ABCDEFGHIJK");
  });
});
