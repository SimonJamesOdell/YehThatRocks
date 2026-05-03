import { describe, expect, it } from "vitest";

import {
  YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_HEIGHT,
  YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_WIDTH,
  isLikelyUnavailableThumbnailDimensions,
} from "@/lib/youtube-thumbnail-health";

describe("youtube thumbnail pre-flight health", () => {
  it("classifies 120x90 thumbnails as likely unavailable placeholders", () => {
    expect(isLikelyUnavailableThumbnailDimensions(
      YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_WIDTH,
      YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_HEIGHT,
    )).toBe(true);
  });

  it("classifies dimensions smaller than placeholder bounds as likely unavailable", () => {
    expect(isLikelyUnavailableThumbnailDimensions(96, 54)).toBe(true);
  });

  it("does not classify regular hq/mq dimensions as unavailable placeholders", () => {
    expect(isLikelyUnavailableThumbnailDimensions(320, 180)).toBe(false);
    expect(isLikelyUnavailableThumbnailDimensions(480, 360)).toBe(false);
    expect(isLikelyUnavailableThumbnailDimensions(1280, 720)).toBe(false);
  });

  it("does not classify invalid or boundary-adjacent oversized dimensions as placeholders", () => {
    expect(isLikelyUnavailableThumbnailDimensions(Number.NaN, 90)).toBe(false);
    expect(isLikelyUnavailableThumbnailDimensions(120, Number.NaN)).toBe(false);
    expect(isLikelyUnavailableThumbnailDimensions(121, 90)).toBe(false);
    expect(isLikelyUnavailableThumbnailDimensions(120, 91)).toBe(false);
  });
});
