"use client";

import { createPortal } from "react-dom";

import type { SuggestOutcome } from "@/components/use-suggest-new-video";

type SuggestNewModalProps = {
  isOpen: boolean;
  suggestSource: string;
  suggestArtist: string;
  suggestTrack: string;
  suggestPending: boolean;
  suggestQuotaStatusPending: boolean;
  suggestQuotaExhausted: boolean;
  suggestError: string | null;
  suggestOutcome: SuggestOutcome | null;
  onClose: () => void;
  onSuggestSourceChange: (value: string) => void;
  onSuggestArtistChange: (value: string) => void;
  onSuggestTrackChange: (value: string) => void;
  onSubmit: () => void;
  onResetForAnother: () => void;
  onWatchNow: () => void;
  onRefreshQuotaStatus: () => void;
};

export function SuggestNewModal({
  isOpen,
  suggestSource,
  suggestArtist,
  suggestTrack,
  suggestPending,
  suggestQuotaStatusPending,
  suggestQuotaExhausted,
  suggestError,
  suggestOutcome,
  onClose,
  onSuggestSourceChange,
  onSuggestArtistChange,
  onSuggestTrackChange,
  onSubmit,
  onResetForAnother,
  onWatchNow,
  onRefreshQuotaStatus,
}: SuggestNewModalProps) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="suggestNewModalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Suggest new YouTube videos"
      onClick={onClose}
    >
      <div className="suggestNewModalPanel" onClick={(event) => event.stopPropagation()}>
        <div className="suggestNewModalHeader">
          <h3>Suggest New</h3>
          <p className="suggestNewModalMeta">Paste a YouTube video or playlist. We will ingest and classify it.</p>
        </div>

        <p className="suggestNewModalHints">
          Accepted formats: <strong>watch URLs</strong>, <strong>short URLs</strong>, <strong>video IDs</strong>, and <strong>playlist URLs</strong>.
        </p>

        {suggestQuotaExhausted ? (
          <div className="suggestNewModalResult suggestNewModalResult-rejected" role="status" aria-live="polite">
            <p className="suggestNewModalResultTitle">YouTube API credits exhausted</p>
            <p className="suggestNewModalResultDetail">
              Suggest New is temporarily unavailable because the YouTube API daily quota is exhausted. Please try again later.
            </p>
          </div>
        ) : null}

        {!suggestQuotaExhausted ? (
          <>
            <label className="newFlagModalField suggestNewModalField" htmlFor="suggest-new-source">
              YouTube URL or Video ID
            </label>
            <input
              className="suggestNewModalInput"
              id="suggest-new-source"
              value={suggestSource}
              onChange={(event) => onSuggestSourceChange(event.currentTarget.value)}
              placeholder="https://youtube.com/watch?v=... or https://youtube.com/playlist?list=..."
              disabled={suggestPending}
              maxLength={2048}
            />

            <div className="suggestNewModalOptionalGrid">
              <label className="newFlagModalField suggestNewModalField" htmlFor="suggest-new-artist">
                Artist (optional)
              </label>
              <input
                className="suggestNewModalInput"
                id="suggest-new-artist"
                value={suggestArtist}
                onChange={(event) => onSuggestArtistChange(event.currentTarget.value)}
                placeholder="Artist name"
                disabled={suggestPending}
                maxLength={255}
              />

              <label className="newFlagModalField suggestNewModalField" htmlFor="suggest-new-track">
                Track name (optional)
              </label>
              <input
                className="suggestNewModalInput"
                id="suggest-new-track"
                value={suggestTrack}
                onChange={(event) => onSuggestTrackChange(event.currentTarget.value)}
                placeholder="Track title"
                disabled={suggestPending}
                maxLength={255}
              />
            </div>
          </>
        ) : null}

        {suggestError ? <p className="newFlagModalStatus suggestNewModalStatus">{suggestError}</p> : null}

        {suggestOutcome ? (
          <div className={`suggestNewModalResult suggestNewModalResult-${suggestOutcome.status}`}>
            <p className="suggestNewModalResultTitle">{suggestOutcome.title}</p>
            <p className="suggestNewModalResultDetail">{suggestOutcome.detail}</p>
            {suggestOutcome.kind === "video" && suggestOutcome.status !== "rejected" ? (
              <div className="suggestNewModalResultMeta">
                <p><strong>Artist:</strong> {suggestOutcome.artist?.trim() || "Unknown"}</p>
                <p><strong>Track:</strong> {suggestOutcome.track?.trim() || "Unknown"}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {suggestOutcome && suggestOutcome.kind === "video" && suggestOutcome.status !== "rejected" ? (
          <div className="newFlagModalActions suggestNewModalActions">
            <button type="button" onClick={onResetForAnother} disabled={suggestPending}>
              Suggest another
            </button>
            <button type="button" onClick={onWatchNow} disabled={suggestPending || !suggestOutcome.videoId}>
              Watch now
            </button>
          </div>
        ) : suggestOutcome ? (
          <div className="newFlagModalActions suggestNewModalActions">
            <button type="button" onClick={onClose} disabled={suggestPending}>
              Close
            </button>
            <button type="button" onClick={onResetForAnother} disabled={suggestPending}>
              Suggest another
            </button>
          </div>
        ) : suggestQuotaExhausted ? (
          <div className="newFlagModalActions suggestNewModalActions">
            <button type="button" onClick={onClose} disabled={suggestPending || suggestQuotaStatusPending}>
              Close
            </button>
            <button
              type="button"
              onClick={onRefreshQuotaStatus}
              disabled={suggestPending || suggestQuotaStatusPending}
            >
              {suggestQuotaStatusPending ? "Checking..." : "Check again"}
            </button>
          </div>
        ) : (
          <div className="newFlagModalActions suggestNewModalActions">
            <button type="button" onClick={onClose} disabled={suggestPending}>
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={suggestPending}
            >
              {suggestPending ? "Submitting..." : "Submit"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
