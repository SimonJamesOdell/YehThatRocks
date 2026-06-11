"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { parseJsonOrNull } from "@/lib/parse-json";
import { TOP_LEVEL_GENRE_BUCKETS, TOP_LEVEL_GENRE_BUCKET_LABELS, resolveTopLevelGenreBucket } from "@/lib/genre-buckets";

type AdminEditableVideo = {
  id: number;
  videoId: string;
  title: string | null;
  channelTitle: string | null;
  genre: string | null;
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
  const [isAutoClassifyingGenre, setIsAutoClassifyingGenre] = useState(false);
  const [adminEditError, setAdminEditError] = useState<string | null>(null);
  const [adminEditStatus, setAdminEditStatus] = useState<string | null>(null);

  const [adminEditVideoRowId, setAdminEditVideoRowId] = useState<number | null>(null);
  const [adminEditTitle, setAdminEditTitle] = useState("");
  const [adminEditChannelTitle, setAdminEditChannelTitle] = useState("");
  const [adminEditGenre, setAdminEditGenre] = useState("");
  const [adminEditParsedArtist, setAdminEditParsedArtist] = useState("");
  const [adminEditParsedTrack, setAdminEditParsedTrack] = useState("");
  const [adminEditParsedVideoType, setAdminEditParsedVideoType] = useState("");
  const [adminEditParseConfidence, setAdminEditParseConfidence] = useState("");
  const [adminEditDescription, setAdminEditDescription] = useState("");
  const adminEditCategoryOptions = [...TOP_LEVEL_GENRE_BUCKET_LABELS, "Unclassified"];
  const adminEditCategoryOptionDetails = new Map(
    TOP_LEVEL_GENRE_BUCKETS.map((bucket) => [bucket.label, bucket.terms]),
  );
  const adminEditGenreSuggestions = Array.from(new Set([
    ...TOP_LEVEL_GENRE_BUCKETS.map((bucket) => bucket.label),
    ...TOP_LEVEL_GENRE_BUCKETS.flatMap((bucket) => bucket.terms),
  ]));

  const selectedCategory = useMemo(() => {
    const normalized = adminEditGenre.trim().toLowerCase();
    if (!normalized) {
      return "Unclassified";
    }

    const exact = adminEditCategoryOptions.find((option) => option.toLowerCase() === normalized);
    if (exact) {
      return exact;
    }

    return resolveTopLevelGenreBucket(adminEditGenre) ?? "Unclassified";
  }, [adminEditCategoryOptions, adminEditGenre]);

  useEffect(() => {
    if (!isOpen) {
      setAdminEditVideoRowId(null);
      setAdminEditError(null);
      setAdminEditStatus(null);
      setIsAdminEditLoading(false);
      setIsAdminEditSaving(false);
      setIsAutoClassifyingGenre(false);
      return;
    }

    // Reset state and trigger load when modal opens.
    // loadVideoDetails immediately sets isAdminEditLoading=true,
    // acting as a natural guard against double-fire in Strict Mode.
    setAdminEditVideoRowId(null);
    setAdminEditError(null);
    setAdminEditStatus(null);
    setIsAdminEditLoading(false);
    setIsAdminEditSaving(false);
    setIsAutoClassifyingGenre(false);

    void loadVideoDetails();
  }, [isOpen, videoId]);

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

      const payload = (await parseJsonOrNull(response)) as { videos?: AdminEditableVideo[] } | null;
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
      setAdminEditGenre(row.genre ?? "");
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
      const normalizedGenre = adminEditGenre.trim();
      const response = await fetchWithAuthRetry("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: adminEditVideoRowId,
          title: adminEditTitle,
          channelTitle: adminEditChannelTitle,
          genre: normalizedGenre.length > 0 ? normalizedGenre : null,
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
    } catch {
      setAdminEditError("An error occurred while saving.");
    } finally {
      setIsAdminEditSaving(false);
    }
  }

  async function handleAutoClassifyGenre() {
    if (!videoId) {
      return;
    }

    setAdminEditError(null);
    setAdminEditStatus(null);
    setIsAutoClassifyingGenre(true);

    try {
      const response = await fetchWithAuthRetry("/api/admin/videos/pending/auto-genre", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAdminEditError("Admin session expired. Please sign in again.");
          return;
        }
        setAdminEditError("Could not auto classify genre.");
        return;
      }

      const payload = await parseJsonOrNull<{
        suggestion?: {
          proposedGenre: string | null;
          confidence: number;
        };
      }>(response);

      const suggestedGenre = payload?.suggestion?.proposedGenre?.trim() || "";
      if (suggestedGenre) {
        setAdminEditGenre(suggestedGenre);
        const confidence = Number(payload?.suggestion?.confidence ?? NaN);
        const confidenceLabel = Number.isFinite(confidence)
          ? `${Math.round(confidence * 100)}%`
          : "n/a";
        setAdminEditStatus(`Auto-classified genre: ${suggestedGenre} (${confidenceLabel}).`);
      } else {
        setAdminEditStatus("Auto-classify returned no genre suggestion.");
      }
    } catch {
      setAdminEditError("Could not auto classify genre.");
    } finally {
      setIsAutoClassifyingGenre(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="shareModalBackdrop adminVideoEditBackdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Edit video record"
    >
      <div className="shareModal adminVideoEditModal" onClick={(event) => event.stopPropagation()}>
        <div className="shareModalHeader">
          <strong>Edit Video Record</strong>
          <button
            type="button"
            className="overlayIconBtn"
            onClick={() => onClose()}
            aria-label="Close editor"
            disabled={isAdminEditSaving || isAutoClassifyingGenre}
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
          <div className="adminVideoEditLayout">
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
                  rows={6}
                />
              </label>
            </div>

            <fieldset className="adminVideoGenrePanel">
              <legend>Category & Genre</legend>
              <label>
                <span>Classified genre</span>
                <div className="adminVideoGenreInputRow">
                  <input
                    list="admin-video-edit-genre-suggestions"
                    value={adminEditGenre}
                    onChange={(event) => setAdminEditGenre(event.currentTarget.value)}
                    maxLength={255}
                    placeholder="Optional specific genre"
                  />
                  <button
                    type="button"
                    className="adminVideoEditButton adminVideoEditButtonSecondary"
                    onClick={() => {
                      void handleAutoClassifyGenre();
                    }}
                    disabled={isAdminEditSaving || isAutoClassifyingGenre || !adminEditVideoRowId}
                  >
                    {isAutoClassifyingGenre ? "Auto..." : "Auto"}
                  </button>
                </div>
                <datalist id="admin-video-edit-genre-suggestions">
                  {adminEditGenreSuggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              </label>

              <table className="adminVideoGenreTable">
                <tbody>
                  {adminEditCategoryOptions.map((option) => {
                    const radioId = `admin-video-edit-category-${option.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                    const isSelected = selectedCategory === option;
                    const optionDetails = adminEditCategoryOptionDetails.get(option) ?? [];

                    return (
                      <tr key={option} className={isSelected ? "adminVideoGenreRowSelected" : undefined}>
                        <td>
                          <input
                            id={radioId}
                            type="radio"
                            name="admin-video-edit-category"
                            value={option}
                            checked={isSelected}
                            onChange={() => setAdminEditGenre(option === "Unclassified" ? "" : option)}
                            disabled={isAdminEditSaving || isAutoClassifyingGenre}
                          />
                        </td>
                        <td>
                          <label htmlFor={radioId}>{option}</label>
                        </td>
                        <td title={optionDetails.join(", ") || "No specific subgenres mapped."}>
                          {optionDetails.length > 0 ? optionDetails.join(", ") : "No specific subgenres mapped."}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </fieldset>
          </div>
        ) : null}

        <div className="adminVideoEditActions">
          <button
            type="button"
            className="adminVideoEditButton adminVideoEditButtonPrimary"
            onClick={() => {
              void handleSaveAdminVideoEdit();
            }}
            disabled={isAdminEditSaving || isAdminEditLoading || isAutoClassifyingGenre || !adminEditVideoRowId}
          >
            {isAdminEditSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}