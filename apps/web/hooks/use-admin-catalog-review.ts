/**
 * Catalog Review Hook
 * Handles QA workflow for catalog videos (approve/remove/undo)
 */

import { useCallback, useRef, useState } from "react";
import { CatalogReviewVideoRow } from "@/components/admin-dashboard-types";
import { postJson, readJson } from "@/components/admin-dashboard-utils";

export function useAdminCatalogReview() {
  const [catalogReviewCurrentVideo, setCatalogReviewCurrentVideo] = useState<CatalogReviewVideoRow | null>(null);
  const [catalogReviewRemaining, setCatalogReviewRemaining] = useState(0);
  const [catalogReviewActionVideoId, setCatalogReviewActionVideoId] = useState<string | null>(null);
  const [previousCatalogAction, setPreviousCatalogAction] = useState<{ action: "approve" | "remove"; videoId: string } | null>(null);
  const [reversingCatalogAction, setReversingCatalogAction] = useState(false);

  const catalogReviewPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const catalogReviewPreviewCurrentTimeRef = useRef<number | null>(null);

  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadCatalogReviewQueue = useCallback(async () => {
    try {
      const payload = await readJson<{
        remaining: number;
        currentVideo: CatalogReviewVideoRow | null;
      }>("/api/admin/videos/catalog-review");

      setCatalogReviewRemaining(Number(payload.remaining ?? 0));
      setCatalogReviewCurrentVideo(payload.currentVideo ?? null);
    } catch (error) {
      throw error;
    }
  }, []);

  const moderateCatalogReviewVideo = useCallback(
    async (action: "approve" | "remove") => {
      if (!catalogReviewCurrentVideo) {
        return;
      }

      const videoId = catalogReviewCurrentVideo.videoId;
      setCatalogReviewActionVideoId(videoId);
      setPreviousCatalogAction({ action, videoId });

      try {
        await postJson<{ ok: boolean; remaining?: number }>("/api/admin/videos/catalog-review", {
          videoId,
          action,
        });

        setSaveMessage(action === "approve" ? `Kept ${videoId}.` : `Removed ${videoId}.`);
        await loadCatalogReviewQueue();
      } catch (moderationError) {
        setSaveMessage(moderationError instanceof Error ? moderationError.message : "Catalog review action failed.");
        setPreviousCatalogAction(null);
        throw moderationError;
      } finally {
        setCatalogReviewActionVideoId(null);
      }
    },
    [catalogReviewCurrentVideo, loadCatalogReviewQueue]
  );

  const reversePreviousCatalogAction = useCallback(async () => {
    if (!previousCatalogAction) {
      return;
    }

    setReversingCatalogAction(true);

    try {
      await postJson<{ ok: boolean; remaining?: number }>("/api/admin/videos/catalog-review-undo", {
        videoId: previousCatalogAction.videoId,
        reversedAction: previousCatalogAction.action,
      });

      setSaveMessage(
        `Reversed: ${previousCatalogAction.action === "approve" ? "moved back to queue" : "removed undo"} for ${previousCatalogAction.videoId}.`
      );
      setPreviousCatalogAction(null);
      await loadCatalogReviewQueue();
    } catch (undoError) {
      setSaveMessage(undoError instanceof Error ? undoError.message : "Reverse action failed.");
      throw undoError;
    } finally {
      setReversingCatalogAction(false);
    }
  }, [previousCatalogAction, loadCatalogReviewQueue]);

  const refreshCatalogReviewMetadata = useCallback(async () => {
    if (!catalogReviewCurrentVideo) {
      return;
    }

    setCatalogReviewActionVideoId(catalogReviewCurrentVideo.videoId);

    try {
      await postJson<{ ok: boolean; video?: { id: number; videoId: string } }>('/api/admin/videos/refetch-data', {
        id: catalogReviewCurrentVideo.id,
        videoId: catalogReviewCurrentVideo.videoId,
      });

      setSaveMessage(`Refreshed metadata for ${catalogReviewCurrentVideo.videoId} from YouTube.`);
      await loadCatalogReviewQueue();
    } catch (refreshError) {
      setSaveMessage(refreshError instanceof Error ? refreshError.message : "Metadata refresh failed.");
      throw refreshError;
    } finally {
      setCatalogReviewActionVideoId(null);
    }
  }, [catalogReviewCurrentVideo, loadCatalogReviewQueue]);

  return {
    // Data
    catalogReviewCurrentVideo,
    catalogReviewRemaining,
    catalogReviewActionVideoId,
    previousCatalogAction,
    reversingCatalogAction,
    // Refs
    catalogReviewPreviewIframeRef,
    catalogReviewPreviewCurrentTimeRef,
    // UI State
    saveMessage,
    // Setters
    setCatalogReviewCurrentVideo,
    setPreviousCatalogAction,
    setSaveMessage,
    // Actions
    loadCatalogReviewQueue,
    moderateCatalogReviewVideo,
    reversePreviousCatalogAction,
    refreshCatalogReviewMetadata,
  };
}
