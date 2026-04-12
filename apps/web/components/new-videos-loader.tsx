"use client";

import { useEffect, useMemo, useState } from "react";

import type { VideoRecord } from "@/lib/catalog";
import { Top100VideoLink } from "@/components/top100-video-link";

function dedupeVideos(videos: VideoRecord[]) {
  const seen = new Set<string>();

  return videos.filter((video) => {
    if (seen.has(video.id)) {
      return false;
    }

    seen.add(video.id);
    return true;
  });
}

function filterHiddenVideos(videos: VideoRecord[], hiddenVideoIdSet: Set<string>) {
  if (hiddenVideoIdSet.size === 0) {
    return videos;
  }

  return videos.filter((video) => !hiddenVideoIdSet.has(video.id));
}

export function NewVideosLoader({
  initialVideos,
  isAuthenticated,
  seenVideoIds = [],
  hiddenVideoIds = [],
}: {
  initialVideos: VideoRecord[];
  isAuthenticated: boolean;
  seenVideoIds?: string[];
  hiddenVideoIds?: string[];
}) {
  const hiddenVideoIdSet = useMemo(() => new Set(hiddenVideoIds), [hiddenVideoIds]);
  const [allVideos, setAllVideos] = useState(() => dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet)));
  const [loading, setLoading] = useState(true);
  const seenVideoIdSet = new Set(seenVideoIds);

  useEffect(() => {
    const loadVideos = async () => {
      try {
        let working = dedupeVideos(filterHiddenVideos(initialVideos, hiddenVideoIdSet));

        if (working.length === 0) {
          const initialResponse = await fetch(`/api/videos/newest?skip=0&take=10`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          });

          if (initialResponse.ok) {
            const { videos } = (await initialResponse.json()) as { videos: VideoRecord[] };
            working = dedupeVideos(filterHiddenVideos(videos, hiddenVideoIdSet));
            setAllVideos(working);
          }
        }

        const remainingTake = Math.max(0, 100 - working.length);
        if (remainingTake > 0) {
          const response = await fetch(`/api/videos/newest?skip=${working.length}&take=${remainingTake}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          });

          if (response.ok) {
            const { videos } = (await response.json()) as { videos: VideoRecord[] };
            setAllVideos((prev) => dedupeVideos([...prev, ...filterHiddenVideos(videos, hiddenVideoIdSet)]));
          }
        }

      } catch (error) {
        console.error("Failed to load new videos:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadVideos();
  }, [hiddenVideoIdSet, initialVideos, isAuthenticated]);

  return (
    <div className="trackStack spanTwoColumns">
      {allVideos.map((track, index) => (
        <Top100VideoLink
          key={track.id}
          track={track}
          index={index}
          isAuthenticated={isAuthenticated}
          isSeen={seenVideoIdSet.has(track.id)}
          rowVariant="new"
        />
      ))}
      {loading && allVideos.length === 0 && (
        <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>Loading more videos...</div>
      )}
    </div>
  );
}
