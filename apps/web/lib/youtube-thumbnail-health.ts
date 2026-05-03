export const YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_WIDTH = 120;
export const YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_HEIGHT = 90;

export function isLikelyUnavailableThumbnailDimensions(
  width: number,
  height: number,
) {
  return width <= YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_WIDTH
    && height <= YOUTUBE_UNAVAILABLE_PLACEHOLDER_MAX_HEIGHT;
}
