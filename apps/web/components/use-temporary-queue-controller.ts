import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { TEMP_QUEUE_DEQUEUE_EVENT, VIDEO_ENDED_EVENT } from "@/lib/events-contract";

export function useTemporaryQueueController(currentVideoId: string) {
  const [temporaryQueueVideos, setTemporaryQueueVideos] = useState<VideoRecord[]>([]);
  const previousVideoIdRef = useRef(currentVideoId);

  const temporaryQueueVideoIdSet = useMemo(
    () => new Set(temporaryQueueVideos.map((video) => video.id)),
    [temporaryQueueVideos],
  );

  useEffect(() => {
    const removeFromTemporaryQueue = (event: Event) => {
      const detail = (event as CustomEvent<{ videoId?: string }>).detail;
      const videoId = detail?.videoId;

      if (!videoId) {
        return;
      }

      setTemporaryQueueVideos((currentQueue) => currentQueue.filter((video) => video.id !== videoId));
    };

    window.addEventListener(VIDEO_ENDED_EVENT, removeFromTemporaryQueue as EventListener);
    window.addEventListener(TEMP_QUEUE_DEQUEUE_EVENT, removeFromTemporaryQueue as EventListener);

    return () => {
      window.removeEventListener(VIDEO_ENDED_EVENT, removeFromTemporaryQueue as EventListener);
      window.removeEventListener(TEMP_QUEUE_DEQUEUE_EVENT, removeFromTemporaryQueue as EventListener);
    };
  }, []);

  useEffect(() => {
    const previousVideoId = previousVideoIdRef.current;
    if (previousVideoId !== currentVideoId) {
      setTemporaryQueueVideos((currentQueue) => currentQueue.filter((video) => video.id !== previousVideoId));
      previousVideoIdRef.current = currentVideoId;
    }
  }, [currentVideoId]);

  const handleAddToTemporaryQueue = useCallback((track: VideoRecord) => {
    setTemporaryQueueVideos((currentQueue) => (
      currentQueue.some((video) => video.id === track.id)
        ? currentQueue
        : [...currentQueue, track]
    ));
  }, []);

  const handleRemoveFromTemporaryQueue = useCallback((videoId: string) => {
    setTemporaryQueueVideos((currentQueue) => currentQueue.filter((video) => video.id !== videoId));
  }, []);

  const handleClearTemporaryQueue = useCallback(() => {
    setTemporaryQueueVideos([]);
  }, []);

  return {
    temporaryQueueVideos,
    temporaryQueueVideoIdSet,
    handleAddToTemporaryQueue,
    handleRemoveFromTemporaryQueue,
    handleClearTemporaryQueue,
  };
}
