"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import {
  SEARCH_FLAG_REASONS,
  SEARCH_FLAG_REASON_LABELS,
  SEARCH_FLAG_REASON_INFO,
  type SearchFlagReason,
} from "@/lib/search-flags";

type SearchFlagButtonProps = {
  videoId: string;
  title: string;
  searchQuery: string;
};

export function SearchFlagButton({ videoId, title, searchQuery }: SearchFlagButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<SearchFlagReason>("not-relevant");
  const [correction, setCorrection] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit() {
    setIsPending(true);
    setStatus(null);

    try {
      const body: Record<string, unknown> = { videoId, reason, query: searchQuery };
      if ((reason === "wrong-artist" || reason === "wrong-trackname") && correction.trim()) {
        body.correction = correction.trim();
      }

      const response = await fetch("/api/search-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setStatus("Could not submit flag. Please try again.");
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; appliedImmediately?: boolean }
        | null;

      if (!payload?.ok) {
        setStatus("Could not submit flag. Please try again.");
        return;
      }

      // Remove card from search results with animation
      const card = document.querySelector(`article[data-video-id="${videoId}"]`);
      if (card instanceof HTMLElement) {
        card.classList.add("searchResultCardRemoving");
        window.setTimeout(() => {
          card.remove();
        }, 260);
      }

      if (payload.appliedImmediately) {
        setStatus("Flag recorded and applied. This video is now excluded.");
      } else {
        setStatus("Flag recorded. Waiting for more input from the community.");
      }

      window.setTimeout(() => {
        setIsOpen(false);
        setCorrection("");
        setStatus(null);
      }, 900);
    } catch {
      setStatus("Could not submit flag. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="top100CardFlagButton"
        aria-label={`Flag ${title} for review`}
        title="Flag result"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(true);
        }}
      >
        ⚑
      </button>
      {isOpen && typeof document !== "undefined"
        ? createPortal(
          <div
            className="newFlagModalBackdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Flag search result"
            onClick={() => {
              if (!isPending) {
                setIsOpen(false);
              }
            }}
          >
            <div className="newFlagModalPanel" onClick={(event) => event.stopPropagation()}>
              <h3>Flag Search Result</h3>
              <p className="newFlagModalMeta">{title}</p>
              <label className="newFlagModalField" htmlFor="search-flag-reason">
                Reason
              </label>
              <select
                id="search-flag-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value as SearchFlagReason);
                  setCorrection("");
                }}
                disabled={isPending}
              >
                {SEARCH_FLAG_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {SEARCH_FLAG_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
              <p className="newFlagModalInfo">{SEARCH_FLAG_REASON_INFO[reason]}</p>
              {(reason === "wrong-artist" || reason === "wrong-trackname") ? (
                <div className="newFlagModalField newFlagModalCorrectionField">
                  <label htmlFor="search-flag-correction">
                    {reason === "wrong-artist" ? "Correct artist" : "Correct track name"}
                  </label>
                  <p className="newFlagModalCorrectionHint">
                    {reason === "wrong-artist"
                      ? "Enter the artist you believe this should be filed under."
                      : "Enter the title you believe this track should use."}
                  </p>
                  <input
                    id="search-flag-correction"
                    type="text"
                    placeholder={reason === "wrong-artist" ? "e.g., Metallica" : "e.g., Enter Sandman"}
                    value={correction}
                    onChange={(event) => setCorrection(event.target.value)}
                    disabled={isPending}
                  />
                </div>
              ) : null}
              {status ? <p className="newFlagModalStatus">{status}</p> : null}
              <div className="newFlagModalActions">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSubmit();
                  }}
                  disabled={isPending}
                >
                  {isPending ? "Submitting..." : "Submit flag"}
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
