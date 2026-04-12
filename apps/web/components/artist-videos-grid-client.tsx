"use client";

import { useCallback, useState } from "react";

import { ArtistVideoLink } from "@/components/artist-video-link";
import type { VideoRecord } from "@/lib/catalog";

type ArtistVideosGridClientProps = {
  initialVideos: VideoRecord[];
  seenVideoIds: string[];
  isAuthenticated: boolean;
};

export function ArtistVideosGridClient({
  initialVideos,
  seenVideoIds,
  isAuthenticated,
}: ArtistVideosGridClientProps) {
  const [videos, setVideos] = useState<VideoRecord[]>(initialVideos);
  const [hidingVideoIds, setHidingVideoIds] = useState<string[]>([]);
  const seenVideoIdSet = new Set(seenVideoIds);

  const handleHideVideo = useCallback(async (video: VideoRecord) => {
    if (!isAuthenticated || hidingVideoIds.includes(video.id)) {
      return;
    }

    setHidingVideoIds((current) => [...current, video.id]);
    setVideos((current) => current.filter((candidate) => candidate.id !== video.id));

    try {
      await fetch("/api/hidden-videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ videoId: video.id }),
      });
    } catch {
      // Keep card hidden even if persistence fails, matching quick-hide behavior elsewhere.
    } finally {
      setHidingVideoIds((current) => current.filter((id) => id !== video.id));
    }
  }, [hidingVideoIds, isAuthenticated]);

  return (
    <div className="categoryVideoGrid artistVideoGrid">
      {videos.map((video) => (
        <ArtistVideoLink
          key={video.id}
          video={video}
          isAuthenticated={isAuthenticated}
          isSeen={seenVideoIdSet.has(video.id)}
          useCornerActions
          onHideVideo={handleHideVideo}
          isHidePending={hidingVideoIds.includes(video.id)}
        />
      ))}
    </div>
  );
}
