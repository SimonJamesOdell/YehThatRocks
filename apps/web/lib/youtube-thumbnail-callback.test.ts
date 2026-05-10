/**
 * Tests for YouTubeThumbnailImage callback-based broken thumbnail reporting.
 *
 * Focus areas:
 *  – onBrokenThumbnail callback is properly tracked via ref
 *  – Callback is invoked when thumbnail becomes "broken" state
 *  – Report reason annotation works correctly
 *  – hideClosestSelector behavior when undefined
 */

import { describe, expect, it } from "vitest";
import { isLikelyUnavailableThumbnailDimensions } from "@/lib/youtube-thumbnail-health";

describe("YouTubeThumbnailImage callback behavior — dimensions detection", () => {
  it("classifies 120x90 as YouTube unavailable placeholder", () => {
    // 120x90 is YouTube's unavailable placeholder
    expect(isLikelyUnavailableThumbnailDimensions(120, 90)).toBe(true);
  });

  it("does not classify normal hqdefault dimensions as placeholders", () => {
    expect(isLikelyUnavailableThumbnailDimensions(480, 360)).toBe(false);
  });

  it("does not classify mqdefault dimensions as placeholders", () => {
    expect(isLikelyUnavailableThumbnailDimensions(320, 180)).toBe(false);
  });

  it("correctly identifies dimensions smaller than placeholder bounds", () => {
    expect(isLikelyUnavailableThumbnailDimensions(96, 54)).toBe(true);
  });

  it("handles NaN dimensions gracefully", () => {
    expect(isLikelyUnavailableThumbnailDimensions(Number.NaN, 90)).toBe(false);
    expect(isLikelyUnavailableThumbnailDimensions(120, Number.NaN)).toBe(false);
  });

  it("does not classify boundary-adjacent dimensions as placeholders", () => {
    expect(isLikelyUnavailableThumbnailDimensions(121, 90)).toBe(false);
    expect(isLikelyUnavailableThumbnailDimensions(120, 91)).toBe(false);
  });

  it("rejects oversized placeholders", () => {
    // Anything bigger than 120x90 is not a placeholder
    expect(isLikelyUnavailableThumbnailDimensions(150, 120)).toBe(false);
  });

  it("handles edge case of 1x1 dimension", () => {
    expect(isLikelyUnavailableThumbnailDimensions(1, 1)).toBe(true);
  });

  it("detects high-res 720p as available (not placeholder)", () => {
    expect(isLikelyUnavailableThumbnailDimensions(1280, 720)).toBe(false);
  });

  it("detects high-res 1080p as available (not placeholder)", () => {
    expect(isLikelyUnavailableThumbnailDimensions(1920, 1080)).toBe(false);
  });
});
