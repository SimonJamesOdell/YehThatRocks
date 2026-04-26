"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";

type AdminVideoDeleteButtonProps = {
  videoId: string;
  title: string;
  isAdmin: boolean;
};

const REMOVE_ANIMATION_MS = 260;

export function AdminVideoDeleteButton({ videoId, title, isAdmin }: AdminVideoDeleteButtonProps) {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!isAdmin) {
    return null;
  }

  async function handleConfirmDelete() {
    const card = document.querySelector(`article[data-video-id="${CSS.escape(videoId)}"]`);
    if (!(card instanceof HTMLElement)) {
      setDeleteError("Could not find this video card in the current view.");
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetchWithAuthRetry("/api/admin/videos", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setDeleteError("Admin session expired. Please sign in again.");
          return;
        }
        setDeleteError("Could not delete this video. Please try again.");
        return;
      }

      card.classList.add("searchResultCardRemoving");
      dispatchAppEvent(EVENT_NAMES.VIDEO_CATALOG_DELETED, { videoId });
      window.setTimeout(() => {
        card.remove();
      }, REMOVE_ANIMATION_MS);
      setShowConfirmModal(false);
    } catch {
      setDeleteError("Could not delete this video. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="searchResultAdminDeleteBtn"
        aria-label={`Permanently delete ${title}`}
        title="Permanently delete video"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDeleteError(null);
          setShowConfirmModal(true);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4h6v2" />
        </svg>
      </button>

      {showConfirmModal
        ? createPortal(
            <div
              className="shareModalBackdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Confirm permanent video deletion"
              onClick={() => {
                if (!isDeleting) {
                  setShowConfirmModal(false);
                }
              }}
            >
              <div className="shareModal adminVideoEditModal" onClick={(event) => event.stopPropagation()}>
                <div className="shareModalHeader">
                  <strong>Delete Video Permanently</strong>
                </div>

                <p className="authMessage">
                  This will remove this video from all related tables and cannot be undone.
                </p>
                <p className="authMessage">{title}</p>
                {deleteError ? <p className="authMessage">{deleteError}</p> : null}

                <div className="adminVideoEditActions">
                  <button
                    type="button"
                    className="adminVideoEditButton adminVideoEditButtonSecondary"
                    onClick={() => setShowConfirmModal(false)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="adminVideoEditButton adminVideoEditButtonPrimary"
                    onClick={() => {
                      void handleConfirmDelete();
                    }}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Delete permanently"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
