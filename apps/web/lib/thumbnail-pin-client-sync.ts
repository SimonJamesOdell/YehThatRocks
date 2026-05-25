"use client";

export const THUMBNAIL_PIN_UPDATED_EVENT = "ytr:thumbnail-pin-updated";

export type ThumbnailPinTarget = "artist" | "category" | "category-artist";

export type ThumbnailPinUpdatedDetail = {
  target: ThumbnailPinTarget;
  genre?: string;
  artistName?: string;
  thumbnailVideoId: string;
};

export function dispatchThumbnailPinUpdated(detail: ThumbnailPinUpdatedDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<ThumbnailPinUpdatedDetail>(THUMBNAIL_PIN_UPDATED_EVENT, {
    detail,
  }));
}
