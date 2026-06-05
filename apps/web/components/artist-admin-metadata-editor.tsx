"use client";

import { useEffect, useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type ArtistAdminMetadataEditorProps = {
  isAdmin: boolean;
  videos: VideoRecord[];
  onVideoPatched: (videoId: string, patch: Partial<VideoRecord>) => void;
};

type DraftState = {
  title: string;
  parsedArtist: string;
  parsedTrack: string;
  genre: string;
};

type AdminVideoLookupRow = {
  id: number;
  videoId: string;
};

const EMPTY_DRAFT: DraftState = {
  title: "",
  parsedArtist: "",
  parsedTrack: "",
  genre: "",
};

function toNullableString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ArtistAdminMetadataEditor({ isAdmin, videos, onVideoPatched }: ArtistAdminMetadataEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [videoRowIdCache, setVideoRowIdCache] = useState<Map<string, number>>(new Map());

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) ?? null,
    [selectedVideoId, videos],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!selectedVideoId && videos.length > 0) {
      setSelectedVideoId(videos[0].id);
      return;
    }

    if (!selectedVideo) {
      return;
    }

    setDraft({
      title: selectedVideo.title ?? "",
      parsedArtist: selectedVideo.parsedArtist ?? "",
      parsedTrack: selectedVideo.parsedTrack ?? "",
      genre: selectedVideo.genre ?? "",
    });
  }, [isOpen, selectedVideo, selectedVideoId, videos]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isRefetching && !isSaving) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isRefetching, isSaving]);

  if (!isAdmin || videos.length === 0) {
    return null;
  }

  async function resolveNumericVideoId(videoId: string) {
    const cachedId = videoRowIdCache.get(videoId);
    if (cachedId) {
      return cachedId;
    }

    const response = await fetchWithAuthRetry(`/api/admin/videos?q=${encodeURIComponent(videoId)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Unable to load admin video row");
    }

    const payload = await response.json() as { videos?: AdminVideoLookupRow[] };
    const row = (payload.videos ?? []).find((entry) => entry.videoId === videoId);
    if (!row) {
      throw new Error("Video row not found in admin catalog list");
    }

    setVideoRowIdCache((current) => {
      const next = new Map(current);
      next.set(videoId, row.id);
      return next;
    });

    return row.id;
  }

  async function handleRefetchSuggestion() {
    if (!selectedVideoId || isRefetching || isSaving) {
      return;
    }

    setStatus("");
    setIsRefetching(true);

    try {
      const response = await fetchWithAuthRetry("/api/admin/videos/metadata-refetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: selectedVideoId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Refetch failed" })) as { error?: string };
        throw new Error(payload.error || "Refetch failed");
      }

      const payload = await response.json() as {
        suggested?: {
          title?: string | null;
          parsedArtist?: string | null;
          parsedTrack?: string | null;
          genre?: string | null;
        };
      };

      const suggested = payload.suggested;
      if (!suggested) {
        throw new Error("No suggestion payload returned");
      }

      setDraft({
        title: suggested.title ?? "",
        parsedArtist: suggested.parsedArtist ?? "",
        parsedTrack: suggested.parsedTrack ?? "",
        genre: suggested.genre ?? "",
      });
      setStatus("Metadata suggestion loaded. Review and save when ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to refetch metadata suggestion");
    } finally {
      setIsRefetching(false);
    }
  }

  async function handleSave() {
    if (!selectedVideoId || isSaving || isRefetching) {
      return;
    }

    const normalizedTitle = draft.title.trim();
    if (!normalizedTitle) {
      setStatus("Title is required.");
      return;
    }

    setStatus("");
    setIsSaving(true);

    try {
      const numericId = await resolveNumericVideoId(selectedVideoId);

      const response = await fetchWithAuthRetry("/api/admin/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: numericId,
          title: normalizedTitle,
          parsedArtist: toNullableString(draft.parsedArtist),
          parsedTrack: toNullableString(draft.parsedTrack),
          genre: toNullableString(draft.genre),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Save failed" })) as { error?: string };
        throw new Error(payload.error || "Save failed");
      }

      onVideoPatched(selectedVideoId, {
        title: normalizedTitle,
        parsedArtist: toNullableString(draft.parsedArtist),
        parsedTrack: toNullableString(draft.parsedTrack),
        genre: toNullableString(draft.genre) ?? "",
      });

      setStatus("Metadata saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save metadata");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="newPageSeenToggle"
        onClick={() => {
          setStatus("");
          setIsOpen(true);
        }}
      >
        Edit Metadata
      </button>

      {isOpen ? (
        <div
          className="newFlagModalBackdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Edit artist page metadata"
          onClick={() => {
            if (!isRefetching && !isSaving) {
              setIsOpen(false);
            }
          }}
        >
          <div className="newFlagModalPanel" style={{ width: "min(94vw, 560px)" }} onClick={(event) => event.stopPropagation()}>
            <h3>Edit Artist Video Metadata</h3>
            <p className="newFlagModalInfo">
              Refetch suggestions, review the values, then save directly to the video row.
            </p>

            <label className="newFlagModalField">
              <span>Video</span>
              <select
                value={selectedVideoId}
                onChange={(event) => {
                  setSelectedVideoId(event.target.value);
                  setStatus("");
                }}
                disabled={isRefetching || isSaving}
              >
                {videos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.id} - {video.parsedTrack?.trim() || video.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="newFlagModalField">
              <span>Title</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Video title"
                disabled={isRefetching || isSaving}
              />
            </label>

            <label className="newFlagModalField">
              <span>Parsed Artist</span>
              <input
                value={draft.parsedArtist}
                onChange={(event) => setDraft((current) => ({ ...current, parsedArtist: event.target.value }))}
                placeholder="Artist name"
                disabled={isRefetching || isSaving}
              />
            </label>

            <label className="newFlagModalField">
              <span>Parsed Track</span>
              <input
                value={draft.parsedTrack}
                onChange={(event) => setDraft((current) => ({ ...current, parsedTrack: event.target.value }))}
                placeholder="Track name"
                disabled={isRefetching || isSaving}
              />
            </label>

            <label className="newFlagModalField">
              <span>Genre</span>
              <input
                value={draft.genre}
                onChange={(event) => setDraft((current) => ({ ...current, genre: event.target.value }))}
                placeholder="Genre"
                disabled={isRefetching || isSaving}
              />
            </label>

            {status ? <p className="newFlagModalStatus">{status}</p> : null}

            <div className="newFlagModalActions">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                disabled={isRefetching || isSaving}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRefetchSuggestion();
                }}
                disabled={isRefetching || isSaving}
              >
                {isRefetching ? "Refetching..." : "Refetch Suggestion"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                disabled={isRefetching || isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
