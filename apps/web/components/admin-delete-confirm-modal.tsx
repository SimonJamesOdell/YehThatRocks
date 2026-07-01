"use client";

import { createPortal } from "react-dom";

interface AdminDeleteConfirmModalProps {
  open: boolean;
  displayTitle: string;
  error: string | null;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function AdminDeleteConfirmModal({
  open,
  displayTitle,
  error,
  isDeleting,
  onClose,
  onConfirm,
}: AdminDeleteConfirmModalProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="shareModalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm permanent video deletion"
      onClick={() => {
        if (!isDeleting) onClose();
      }}
    >
      <div className="shareModal adminVideoEditModal" onClick={(event) => event.stopPropagation()}>
        <div className="shareModalHeader">
          <strong>Delete Video Permanently</strong>
        </div>

        <p className="authMessage">
          This will remove this video from all related tables and cannot be undone.
        </p>
        <p className="authMessage">{displayTitle}</p>
        {error ? <p className="authMessage">{error}</p> : null}

        <div className="adminVideoEditActions">
          <button
            type="button"
            className="adminVideoEditButton adminVideoEditButtonSecondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="adminVideoEditButton adminVideoEditButtonPrimary"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
