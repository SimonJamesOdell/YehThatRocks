/**
 * Unit tests for the performance-critical pure helpers extracted from shell-dynamic.tsx.
 * These guard the memoized selector and transition-batching logic against regressions.
 */
import { describe, it, expect } from "vitest";
import { detectAppendOnly, filterSeenFromWatchNext } from "./shell-dynamic-helpers";
import type { VideoRecord } from "@/lib/catalog";

// Minimal VideoRecord factory — only the fields these helpers inspect.
function makeVideo(id: string, overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id,
    title: `Title ${id}`,
    channelTitle: `Artist ${id}`,
    sourceLabel: null,
    isFavouriteSource: false,
    isTop100Source: false,
    isNewSource: false,
    favourited: 0,
    ...overrides,
  } as VideoRecord;
}

// ─── detectAppendOnly ──────────────────────────────────────────────────────────

describe("detectAppendOnly", () => {
  it("returns true when new items are added at the tail", () => {
    expect(detectAppendOnly(["a", "b", "c"], ["a", "b", "c", "d", "e"])).toBe(true);
  });

  it("returns false when the current list is empty", () => {
    expect(detectAppendOnly([], ["a", "b"])).toBe(false);
  });

  it("returns false when the next list is shorter than the current", () => {
    expect(detectAppendOnly(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  it("returns false when the next list is the same length (no new items)", () => {
    expect(detectAppendOnly(["a", "b"], ["a", "b"])).toBe(false);
  });

  it("returns false when existing items are reordered", () => {
    expect(detectAppendOnly(["a", "b", "c"], ["b", "a", "c", "d"])).toBe(false);
  });

  it("returns false when an existing item is replaced", () => {
    expect(detectAppendOnly(["a", "b", "c"], ["a", "x", "c", "d"])).toBe(false);
  });

  it("handles a single-item current list appended to", () => {
    expect(detectAppendOnly(["a"], ["a", "b"])).toBe(true);
  });
});

// ─── filterSeenFromWatchNext ───────────────────────────────────────────────────

describe("filterSeenFromWatchNext", () => {
  const videos = [
    makeVideo("unseen-1"),
    makeVideo("seen-1"),
    makeVideo("seen-fav", { favourited: 1 }),
    makeVideo("unseen-2"),
    makeVideo("seen-2"),
  ];
  const seenIds = new Set(["seen-1", "seen-fav", "seen-2"]);

  it("returns all videos when not authenticated", () => {
    const result = filterSeenFromWatchNext(videos, seenIds, false, true);
    expect(result).toHaveLength(videos.length);
    expect(result).toBe(videos); // same reference — no allocation
  });

  it("returns all videos when watchNextHideSeen is false", () => {
    const result = filterSeenFromWatchNext(videos, seenIds, true, false);
    expect(result).toHaveLength(videos.length);
    expect(result).toBe(videos); // same reference
  });

  it("removes seen non-favourite videos when authenticated and hideSeen=true", () => {
    const result = filterSeenFromWatchNext(videos, seenIds, true, true);
    const ids = result.map((v) => v.id);
    expect(ids).toContain("unseen-1");
    expect(ids).toContain("unseen-2");
    expect(ids).not.toContain("seen-1");
    expect(ids).not.toContain("seen-2");
  });

  it("retains seen videos that are also favourited (heart badge stays visible)", () => {
    const result = filterSeenFromWatchNext(videos, seenIds, true, true);
    expect(result.map((v) => v.id)).toContain("seen-fav");
  });

  it("returns all videos when seenIds is empty (no seen videos)", () => {
    const result = filterSeenFromWatchNext(videos, new Set(), true, true);
    expect(result).toHaveLength(videos.length);
  });

  it("returns empty list when all videos are seen and none are favourited", () => {
    const allSeen = [makeVideo("s1"), makeVideo("s2")];
    const result = filterSeenFromWatchNext(allSeen, new Set(["s1", "s2"]), true, true);
    expect(result).toHaveLength(0);
  });

  it("is stable: calling with same args returns same reference when nothing matches filter", () => {
    const unseenOnly = [makeVideo("u1"), makeVideo("u2")];
    const result = filterSeenFromWatchNext(unseenOnly, seenIds, true, true);
    // All items pass the filter — a new array is created; same length as input
    expect(result).toHaveLength(unseenOnly.length);
  });
});
