"use client";

import Image from "next/image";
import { useEffect } from "react";
import { createPortal } from "react-dom";

type HideVideoConfirmModalProps = {
  isOpen: boolean;
  video: {
    id: string;
    title: string;
    thumbnail?: string | null;
  } | null;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function buildThumbnail(videoId: string, thumbnail?: string | null) {
  if (thumbnail && thumbnail.trim().length > 0) {
    return thumbnail;
  }

  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

export function HideVideoConfirmModal({ isOpen, video, isPending = false, onCancel, onConfirm }: HideVideoConfirmModalProps) {
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
      aria-label={`Confirm exclusion for ${video.title}`}
      onClick={() => {
        if (!isPending) {
          onCancel();
        }
      }}
    >
      <div className="shareModal hideVideoConfirmModal" onClick={(event) => event.stopPropagation()}>
        <div className="shareModalHeader hideVideoConfirmHeader">
          <strong className="hideVideoConfirmTitle">Exclude This Video?</strong>
        </div>

        <div className="hideVideoConfirmPreview">
          <Image
            src={buildThumbnail(video.id, video.thumbnail)}
            alt={`Thumbnail for ${video.title}`}
            className="hideVideoConfirmThumb"
            width={320}
            height={180}
            loading="lazy"
          />
          <div className="hideVideoConfirmPreviewCopy">
            <p className="hideVideoConfirmEyebrow">Will be added to blocked videos</p>
            <p className="hideVideoConfirmVideoTitle">{video.title}</p>
          </div>
        </div>

        <p className="shareModalSubtitle hideVideoConfirmMessage">
          This video will stop appearing for your account. You will not see it again unless you visit Account -&gt; Blocked videos and remove the blockage.
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
            {isPending ? "Excluding..." : "Confirm exclusion"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}