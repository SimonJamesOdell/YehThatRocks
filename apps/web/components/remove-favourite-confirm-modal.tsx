"use client";

import Image from "next/image";
import { useEffect } from "react";
import { createPortal } from "react-dom";

type RemoveFavouriteConfirmModalProps = {
  isOpen: boolean;
  video: {
    id: string;
    title: string;
  } | null;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function buildThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

export function RemoveFavouriteConfirmModal({
  isOpen,
  video,
  isPending = false,
  onCancel,
  onConfirm,
}: RemoveFavouriteConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isPending, onCancel]);

  if (!isOpen || !video || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="shareModalBackdrop hideVideoConfirmBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Confirm removal from favourites for ${video.title}`}
      onClick={() => {
        if (!isPending) {
          onCancel();
        }
      }}
    >
      <div className="shareModal hideVideoConfirmModal" onClick={(event) => event.stopPropagation()}>
        <div className="shareModalHeader hideVideoConfirmHeader">
          <strong className="hideVideoConfirmTitle">Remove From Favourites?</strong>
        </div>

        <div className="hideVideoConfirmPreview">
          <Image
            src={buildThumbnail(video.id)}
            alt={`Thumbnail for ${video.title}`}
            className="hideVideoConfirmThumb"
            width={320}
            height={180}
            loading="lazy"
          />
          <div className="hideVideoConfirmPreviewCopy">
            <p className="hideVideoConfirmEyebrow">Will be removed from your favourites</p>
            <p className="hideVideoConfirmVideoTitle">{video.title}</p>
          </div>
        </div>

        <p className="shareModalSubtitle hideVideoConfirmMessage">
          This video will be removed from your favourites list. You can add it back again at any time.
        </p>

        <div className="adminVideoEditActions hideVideoConfirmActions">
          <button
            type="button"
            className="adminVideoEditButton adminVideoEditButtonSecondary"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="adminVideoEditButton adminVideoEditButtonPrimary"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Removing..." : "Confirm removal"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
