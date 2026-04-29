"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type AdminEditableVideo = {
  id: number;
  videoId: string;
  title: string | null;
  channelTitle: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  description: string | null;
};

type AdminVideoEditModalProps = {
  isOpen: boolean;
  videoId: string;
  onClose: () => void;
  onSaveComplete?: (updates: { title: string; channelTitle: string; parsedArtist: string }) => void;
};

export function AdminVideoEditModal({ isOpen, videoId, onClose, onSaveComplete }: AdminVideoEditModalProps) {
  const [isAdminEditLoading, setIsAdminEditLoading] = useState(false);
  const [isAdminEditSaving, setIsAdminEditSaving] = useState(false);
  const [adminEditError, setAdminEditError] = useState<string | null>(null);
  const [adminEditStatus, setAdminEditStatus] = useState<string | null>(null);

  const [adminEditVideoRowId, setAdminEditVideoRowId] = useState<number | null>(null);
  const [adminEditTitle, setAdminEditTitle] = useState("");
  const [adminEditChannelTitle, setAdminEditChannelTitle] = useState("");
  const [adminEditParsedArtist, setAdminEditParsedArtist] = useState("");
  const [adminEditParsedTrack, setAdminEditParsedTrack] = useState("");
  const [adminEditParsedVideoType, setAdminEditParsedVideoType] = useState("");
  const [adminEditParseConfidence, setAdminEditParseConfidence] = useState("");
  const [adminEditDescription, setAdminEditDescription] = useState("");

  async function loadVideoDetails() {
    setIsAdminEditLoading(true);
    setAdminEditError(null);
    setAdminEditStatus(null);

    try {
      const response = await fetchWithAuthRetry(`/api/admin/videos?q=${encodeURIComponent(videoId)}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAdminEditError("Admin session expired. Please sign in again.");
          return;
        }
        setAdminEditError("Could not load video details.");
        return;
      }

      const payload = (await response.json().catch(() => null)) as { videos?: AdminEditableVideo[] } | null;
      const row = Array.isArray(payload?.videos)
        ? payload.videos.find((video) => video.videoId === videoId) ?? null
        : null;

      if (!row) {
        setAdminEditError("Video record not found.");
        return;
      }

      setAdminEditVideoRowId(row.id);
      setAdminEditTitle(row.title ?? "");
      setAdminEditChannelTitle(row.channelTitle ?? "");
      setAdminEditParsedArtist(row.parsedArtist ?? "");
      setAdminEditParsedTrack(row.parsedTrack ?? "");
      setAdminEditParsedVideoType(row.parsedVideoType ?? "");
      setAdminEditParseConfidence(
        row.parseConfidence === null || row.parseConfidence === undefined ? "" : String(row.parseConfidence),
      );
      setAdminEditDescription(row.description ?? "");
    } finally {
      setIsAdminEditLoading(false);
    }
  }

  async function handleSaveAdminVideoEdit() {
    if (!adminEditVideoRowId) {
      return;
    }

    setIsAdminEditSaving(true);
    setAdminEditError(null);
    setAdminEditStatus(null);

    const confidenceValue = adminEditParseConfidence.trim();
    let parseConfidence: number | null = null;

    if (confidenceValue.length > 0) {
      const parsed = Number(confidenceValue);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        setAdminEditError("Parse confidence must be between 0 and 1.");
        setIsAdminEditSaving(false);
        return;
      }
      parseConfidence = parsed;
    }

    try {
      const response = await fetchWithAuthRetry("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: adminEditVideoRowId,
          title: adminEditTitle,
          channelTitle: adminEditChannelTitle,
          parsedArtist: adminEditParsedArtist,
          parsedTrack: adminEditParsedTrack,
          parsedVideoType: adminEditParsedVideoType,
          parseConfidence,
          description: adminEditDescription,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAdminEditError("Admin session expired. Please sign in again.");
          return;
        }
        setAdminEditError("Could not save changes.");
        return;
      }

      setAdminEditStatus("Changes saved!");
      onSaveComplete?.({
        title: adminEditTitle,
        channelTitle: adminEditChannelTitle,
        parsedArtist: adminEditParsedArtist,
      });

      setTimeout(() => {
        setAdminEditStatus(null);
        onClose();
      }, 1000);
    } catch {
      setAdminEditError("An error occurred while saving.");
    } finally {
      setIsAdminEditSaving(false);
    }
  }

  // Load video details when modal opens
  if (isOpen && !adminEditVideoRowId && !isAdminEditLoading && adminEditError === null) {
    void loadVideoDetails();
  }

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="shareModalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Edit video record"
      onClick={() => {
        if (!isAdminEditSaving) {
          onClose();
        }
      }}
    >
      <div className="shareModal adminVideoEditModal" onClick={(event) => event.stopPropagation()}>
        <div className="shareModalHeader">
          <strong>Edit Video Record</strong>
          <button
            type="button"
            className="overlayIconBtn"
            onClick={() => onClose()}
            aria-label="Close editor"
            disabled={isAdminEditSaving}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {isAdminEditLoading ? <p className="authMessage">Loading video details...</p> : null}
        {adminEditError ? <p className="authMessage">{adminEditError}</p> : null}
        {adminEditStatus ? <p className="authMessage">{adminEditStatus}</p> : null}

        {!isAdminEditLoading ? (
          <div className="adminVideoEditGrid">
            <label>
              <span>Title</span>
              <input
                value={adminEditTitle}
                onChange={(event) => setAdminEditTitle(event.currentTarget.value)}
                maxLength={255}
              />
            </label>
            <label>
              <span>Channel title</span>
              <input
                value={adminEditChannelTitle}
                onChange={(event) => setAdminEditChannelTitle(event.currentTarget.value)}
                maxLength={255}
              />
            </label>
            <label>
              <span>Parsed artist</span>
              <input
                value={adminEditParsedArtist}
                onChange={(event) => setAdminEditParsedArtist(event.currentTarget.value)}
                maxLength={255}
              />
            </label>
            <label>
              <span>Parsed track</span>
              <input
                value={adminEditParsedTrack}
                onChange={(event) => setAdminEditParsedTrack(event.currentTarget.value)}
                maxLength={255}
              />
            </label>
            <label>
              <span>Video type</span>
              <input
                value={adminEditParsedVideoType}
                onChange={(event) => setAdminEditParsedVideoType(event.currentTarget.value)}
                maxLength={50}
              />
            </label>
            <label>
              <span>Parse confidence (0-1)</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={adminEditParseConfidence}
                onChange={(event) => setAdminEditParseConfidence(event.currentTarget.value)}
              />
            </label>
            <label className="adminVideoEditFieldFull">
              <span>Description</span>
              <textarea
                value={adminEditDescription}
                onChange={(event) => setAdminEditDescription(event.currentTarget.value)}
                rows={4}
              />
            </label>
          </div>
        ) : null}

        <div className="adminVideoEditActions">
          <button
            type="button"
            className="adminVideoEditButton adminVideoEditButtonSecondary"
            onClick={() => onClose()}
            disabled={isAdminEditSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="adminVideoEditButton adminVideoEditButtonPrimary"
            onClick={() => {
              void handleSaveAdminVideoEdit();
            }}
            disabled={isAdminEditSaving || isAdminEditLoading || !adminEditVideoRowId}
          >
            {isAdminEditSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
