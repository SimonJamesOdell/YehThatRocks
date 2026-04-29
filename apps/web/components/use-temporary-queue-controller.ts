import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import type { QueueRemovalReason } from "@/lib/events-contract";
import { mutateTemporaryQueue as mutateTemporaryQueueDomain, type QueueMutation } from "@/domains/queue/temporary-queue";
import { TEMP_QUEUE_DEQUEUE_EVENT, VIDEO_ENDED_EVENT } from "@/lib/events-contract";

export function useTemporaryQueueController(currentVideoId: string) {
  const [temporaryQueueVideos, setTemporaryQueueVideos] = useState<VideoRecord[]>([]);
  const previousVideoIdRef = useRef(currentVideoId);

  const mutateTemporaryQueue = useCallback((mutation: QueueMutation) => {
    setTemporaryQueueVideos((currentQueue) => mutateTemporaryQueueDomain(currentQueue, mutation));
  }, []);

  const temporaryQueueVideoIdSet = useMemo(
    () => new Set(temporaryQueueVideos.map((video) => video.id)),
    [temporaryQueueVideos],
  );

  useEffect(() => {
    const removeFromTemporaryQueue = (event: Event, defaultReason: QueueRemovalReason) => {
      const detail = (event as CustomEvent<{ videoId?: string; reason?: QueueRemovalReason }>).detail;
      const videoId = detail?.videoId;
      const reason = detail?.reason ?? defaultReason;

      if (!videoId) {
        return;
      }

      mutateTemporaryQueue({
        type: "remove",
        videoId,
        reason,
      });
    };

    const handleEndedQueueRemoval = (event: Event) => {
      removeFromTemporaryQueue(event, "ended");
    };

    const handleManualNextQueueRemoval = (event: Event) => {
      removeFromTemporaryQueue(event, "manual-next");
    };

    window.addEventListener(VIDEO_ENDED_EVENT, handleEndedQueueRemoval as EventListener);
    window.addEventListener(TEMP_QUEUE_DEQUEUE_EVENT, handleManualNextQueueRemoval as EventListener);

    return () => {
      window.removeEventListener(VIDEO_ENDED_EVENT, handleEndedQueueRemoval as EventListener);
      window.removeEventListener(TEMP_QUEUE_DEQUEUE_EVENT, handleManualNextQueueRemoval as EventListener);
    };
  }, [mutateTemporaryQueue]);

  useEffect(() => {
    const previousVideoId = previousVideoIdRef.current;
    if (previousVideoId !== currentVideoId) {
      mutateTemporaryQueue({
        type: "remove",
        videoId: previousVideoId,
        reason: "transition-sync",
      });
      previousVideoIdRef.current = currentVideoId;
    }
  }, [currentVideoId, mutateTemporaryQueue]);

  const handleAddToTemporaryQueue = useCallback((track: VideoRecord) => {
    mutateTemporaryQueue({
      type: "add",
      track,
    });
  }, [mutateTemporaryQueue]);

  const handleRemoveFromTemporaryQueue = useCallback((videoId: string, reason: QueueRemovalReason = "transition-sync") => {
    mutateTemporaryQueue({
      type: "remove",
      videoId,
      reason,
    });
  }, [mutateTemporaryQueue]);

  const handleClearTemporaryQueue = useCallback(() => {
    mutateTemporaryQueue({
      type: "clear",
    });
  }, [mutateTemporaryQueue]);

  return {
    temporaryQueueVideos,
    temporaryQueueVideoIdSet,
    mutateTemporaryQueue,
    handleAddToTemporaryQueue,
    handleRemoveFromTemporaryQueue,
    handleClearTemporaryQueue,
  };
}
