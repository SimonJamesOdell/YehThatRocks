"use client";

import { useCallback, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";
import type { VideoQualityFlagReason } from "@/lib/video-quality-flags";

type UseNewVideosModerationOptions = {
  isAuthenticated: boolean;
  isAdminUser: boolean;
  onRemoveVideoById: (videoId: string) => void;
};

export function useNewVideosModeration({
  isAuthenticated,
  isAdminUser,
  onRemoveVideoById,
}: UseNewVideosModerationOptions) {
  const [hidingVideoIds, setHidingVideoIds] = useState<string[]>([]);
  const [videoPendingHideConfirm, setVideoPendingHideConfirm] = useState<VideoRecord | null>(null);
  const [flaggingVideo, setFlaggingVideo] = useState<VideoRecord | null>(null);
  const [flagReason, setFlagReason] = useState<VideoQualityFlagReason>("broken-playback");
  const [flagPendingVideoId, setFlagPendingVideoId] = useState<string | null>(null);
  const [flagStatus, setFlagStatus] = useState<string | null>(null);

  const handleHideVideo = useCallback((track: VideoRecord) => {
    if (!isAuthenticated || hidingVideoIds.includes(track.id)) {
      return;
    }

    setVideoPendingHideConfirm(track);
  }, [hidingVideoIds, isAuthenticated]);

  const cancelHideVideo = useCallback(() => {
    setVideoPendingHideConfirm(null);
  }, []);

  const confirmHideVideo = useCallback(async () => {
    const track = videoPendingHideConfirm;

    if (!track || !isAuthenticated || hidingVideoIds.includes(track.id)) {
      return;
    }

    setVideoPendingHideConfirm(null);
    await mutateHiddenVideo({
      action: "hide",
      videoId: track.id,
      onOptimisticUpdate: () => {
        setHidingVideoIds((current) => [...current, track.id]);
        onRemoveVideoById(track.id);
      },
      onSettled: () => {
        setHidingVideoIds((current) => current.filter((id) => id !== track.id));
      },
    });
  }, [hidingVideoIds, isAuthenticated, onRemoveVideoById, videoPendingHideConfirm]);

  const handleOpenFlagDialog = useCallback((track: VideoRecord) => {
    setFlaggingVideo(track);
    setFlagReason("broken-playback");
    setFlagStatus(null);
  }, []);

  const handleCloseFlagDialog = useCallback(() => {
    if (flagPendingVideoId) {
      return;
    }

    setFlaggingVideo(null);
    setFlagStatus(null);
  }, [flagPendingVideoId]);

  const handleSubmitFlag = useCallback(async () => {
    if (!flaggingVideo || flagPendingVideoId) {
      return;
    }

    setFlagPendingVideoId(flaggingVideo.id);
    setFlagStatus(null);

    try {
      const response = await fetch("/api/videos/flags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoId: flaggingVideo.id,
          reason: flagReason,
        }),
      });

      if (!response.ok) {
        setFlagStatus("Could not submit flag. Please try again.");
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
          ok?: boolean;
          actedGlobally?: boolean;
          excludedForUser?: boolean;
        }
        | null;

      if (!payload?.ok) {
        setFlagStatus("Could not submit flag. Please try again.");
        return;
      }

      onRemoveVideoById(flaggingVideo.id);

      if (isAdminUser || payload.actedGlobally) {
        setFlagStatus("Flag recorded. This video is now excluded globally.");
      } else if (payload.excludedForUser) {
        setFlagStatus("Flag recorded. This video is now hidden for your account.");
      } else {
        setFlagStatus("Flag recorded.");
      }

      window.setTimeout(() => {
        setFlaggingVideo(null);
        setFlagStatus(null);
      }, 900);
    } catch {
      setFlagStatus("Could not submit flag. Please try again.");
    } finally {
      setFlagPendingVideoId(null);
    }
  }, [flagPendingVideoId, flagReason, flaggingVideo, isAdminUser, onRemoveVideoById]);

  return {
    cancelHideVideo,
    confirmHideVideo,
    flagPendingVideoId,
    flagReason,
    flagStatus,
    flaggingVideo,
    handleCloseFlagDialog,
    handleHideVideo,
    handleOpenFlagDialog,
    handleSubmitFlag,
    hidingVideoIds,
    setFlagReason,
    videoPendingHideConfirm,
  };
}
