/**
 * Video Moderation Hook
 * Handles pending videos, approvals, rejections, imports, and drafts
 */

import { useCallback, useRef, useState } from "react";
import { PendingVideoRow, VideoRow, RecentlyApprovedVideoRow, PendingVideoDraft } from "@/components/admin-dashboard-types";
import { readJson, patchJson, postJson } from "@/components/admin-dashboard-utils";

export function useAdminVideoModeration() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [pendingVideos, setPendingVideos] = useState<PendingVideoRow[]>([]);
  const [recentlyApprovedVideos, setRecentlyApprovedVideos] = useState<RecentlyApprovedVideoRow[]>([]);
  const [pendingVideoDrafts, setPendingVideoDrafts] = useState<Record<number, PendingVideoDraft>>({});
  const [pendingPreviewSkipOffsets, setPendingPreviewSkipOffsets] = useState<Record<number, number>>({});
  const pendingPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const pendingPreviewCurrentTimeRef = useRef<number | null>(null);

  const [videoQuery, setVideoQuery] = useState("");
  const [videoImportSource, setVideoImportSource] = useState("");
  const [ingestingVideo, setIngestingVideo] = useState(false);
  const [moderatingVideoId, setModeratingVideoId] = useState<string | null>(null);
  const [revokingVideoId, setRevokingVideoId] = useState<string | null>(null);
  const [videoModerationPane, setVideoModerationPane] = useState<"pending" | "recent">("pending");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pendingVideoTotal, setPendingVideoTotal] = useState(0);

  const loadVideos = useCallback(async () => {
    try {
      const videoPayload = await readJson<{ videos: VideoRow[] }>(
        `/api/admin/videos${videoQuery ? `?q=${encodeURIComponent(videoQuery)}` : ""}`
      );
      setVideos(videoPayload.videos);
    } catch (error) {
      throw error;
    }
  }, [videoQuery]);

  const loadPendingVideos = useCallback(async () => {
    try {
      const pendingPayload = await readJson<{ pendingVideos: PendingVideoRow[]; totalPending?: number }>(
        "/api/admin/videos/pending"
      );
      setPendingVideos(pendingPayload.pendingVideos);
      setPendingVideoTotal(Number(pendingPayload.totalPending ?? pendingPayload.pendingVideos.length));

      setPendingVideoDrafts((current) => {
        const liveIds = new Set(pendingPayload.pendingVideos.map((item) => item.id));
        const next: Record<number, PendingVideoDraft> = {};
        for (const [key, draft] of Object.entries(current)) {
          const id = Number(key);
          if (liveIds.has(id)) {
            next[id] = draft;
          }
        }
        return next;
      });

      setPendingPreviewSkipOffsets((current) => {
        const liveIds = new Set(pendingPayload.pendingVideos.map((item) => item.id));
        const next: Record<number, number> = {};
        for (const [key, offset] of Object.entries(current)) {
          const id = Number(key);
          if (liveIds.has(id)) {
            next[id] = offset;
          }
        }
        return next;
      });
    } catch (error) {
      throw error;
    }
  }, []);

  const loadRecentlyApprovedVideos = useCallback(async () => {
    try {
      const payload = await readJson<{ recentlyApproved: RecentlyApprovedVideoRow[] }>(
        "/api/admin/videos/recently-approved"
      );
      setRecentlyApprovedVideos(payload.recentlyApproved);
    } catch {
      // Non-fatal — keep last known list.
    }
  }, []);

  const saveVideo = useCallback(async (row: VideoRow) => {
    try {
      await patchJson("/api/admin/videos", row);
      setSaveMessage(`Saved video ${row.videoId}.`);
      await Promise.all([loadVideos(), loadPendingVideos()]);
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : "Video save failed.");
      throw saveError;
    }
  }, [loadVideos, loadPendingVideos]);

  const importVideoFromSource = useCallback(async () => {
    const source = videoImportSource.trim();
    if (!source) {
      setSaveMessage("Paste a YouTube URL or video id first.");
      return;
    }

    setIngestingVideo(true);

    try {
      const response = await postJson<{
        ok: boolean;
        videoId: string;
        decision?: { allowed: boolean; reason: string; message?: string };
      }>("/api/admin/videos/import", { source });

      if (response.ok) {
        setSaveMessage(`Imported video ${response.videoId}.`);
      } else {
        const detail = response.decision?.message ?? response.decision?.reason ?? "Video cannot be imported.";
        setSaveMessage(`Import blocked for ${response.videoId}: ${detail}`);
      }

      setVideoImportSource("");
      await Promise.all([loadVideos(), loadPendingVideos()]);
    } catch (importError) {
      setSaveMessage(importError instanceof Error ? importError.message : "Video import failed.");
      throw importError;
    } finally {
      setIngestingVideo(false);
    }
  }, [videoImportSource, loadVideos, loadPendingVideos]);

  const moderatePendingVideo = useCallback(
    async (row: PendingVideoRow, action: "approve" | "remove") => {
      const videoId = row.videoId;
      setModeratingVideoId(videoId);

      try {
        const draft = pendingVideoDrafts[row.id];
        const titleToApprove = (draft?.title ?? row.title).trim();
        const parsedArtistToApprove = (draft !== undefined ? (draft.parsedArtist ?? "") : (row.parsedArtist ?? "")).trim() || null;
        const parsedTrackToApprove = (draft !== undefined ? (draft.parsedTrack ?? "") : (row.parsedTrack ?? "")).trim() || null;

        const payload: {
          videoId: string;
          action: "approve" | "remove";
          title?: string;
          parsedArtist?: string | null;
          parsedTrack?: string | null;
        } = { videoId, action };

        if (action === "approve") {
          payload.title = titleToApprove;
          payload.parsedArtist = parsedArtistToApprove;
          payload.parsedTrack = parsedTrackToApprove;
        }

        await postJson<{ ok: boolean }>("/api/admin/videos/pending", payload);
        setPendingVideoDrafts((current) => {
          if (!(row.id in current)) {
            return current;
          }
          const next = { ...current };
          delete next[row.id];
          return next;
        });

        setSaveMessage(action === "approve" ? `Approved ${videoId}.` : `Removed ${videoId}.`);
        await Promise.all([loadPendingVideos(), loadVideos()]);
      } catch (moderationError) {
        setSaveMessage(moderationError instanceof Error ? moderationError.message : "Pending moderation action failed.");
        throw moderationError;
      } finally {
        setModeratingVideoId(null);
      }
    },
    [pendingVideoDrafts, loadPendingVideos, loadVideos]
  );

  return {
    // Data
    videos,
    pendingVideos,
    recentlyApprovedVideos,
    pendingVideoDrafts,
    pendingPreviewSkipOffsets,
    pendingVideoTotal,
    // Refs
    pendingPreviewIframeRef,
    pendingPreviewCurrentTimeRef,
    // UI State
    videoQuery,
    videoImportSource,
    ingestingVideo,
    moderatingVideoId,
    revokingVideoId,
    videoModerationPane,
    saveMessage,
    // Setters
    setVideoQuery,
    setVideoImportSource,
    setModeratingVideoId,
    setRevokingVideoId,
    setVideoModerationPane,
    setPendingVideoDrafts,
    setPendingPreviewSkipOffsets,
    setSaveMessage,
    // Actions
    loadVideos,
    loadPendingVideos,
    loadRecentlyApprovedVideos,
    saveVideo,
    importVideoFromSource,
    moderatePendingVideo,
  };
}
