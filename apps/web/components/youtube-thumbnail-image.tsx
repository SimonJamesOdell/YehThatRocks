"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type YouTubeThumbnailImageProps = {
  videoId: string;
  alt: string;
  className?: string;
  format?: "mqdefault" | "hqdefault";
  loading?: "lazy" | "eager";
  decoding?: "async" | "auto" | "sync";
  fetchPriority?: "high" | "low" | "auto";
  hideClosestSelector?: string;
  reportReason?: string;
};

type ThumbState = "unknown" | "ready" | "broken";

// Keyed by videoId (not URL). The probe always uses hqdefault which returns
// HTTP 404 for private/deleted/unavailable videos, unlike mqdefault which
// returns a generic placeholder image (200 OK) even for unavailable videos.
const thumbnailHealthCache = new Map<string, ThumbState>();
const unavailableReportSent = new Set<string>();

function buildThumbUrl(videoId: string, format: "mqdefault" | "hqdefault") {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${format}.jpg`;
}

// Always probe with hqdefault — it reliably returns 404 for unavailable videos.
// mqdefault returns a generic placeholder (200 OK) regardless of availability.
function buildProbeUrl(videoId: string) {
  return buildThumbUrl(videoId, "hqdefault");
}

function reportUnavailable(videoId: string, reason: string) {
  const reportKey = `${videoId}:${reason}`;
  if (unavailableReportSent.has(reportKey)) {
    return;
  }
  unavailableReportSent.add(reportKey);

  void fetch("/api/videos/unavailable", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    keepalive: true,
    body: JSON.stringify({
      videoId,
      reason,
    }),
  }).catch(() => {
    // Best-effort client report only.
  });
}

export function YouTubeThumbnailImage({
  videoId,
  alt,
  className,
  format = "mqdefault",
  loading = "lazy",
  decoding = "async",
  fetchPriority,
  hideClosestSelector = "[data-video-id]",
  reportReason = "thumbnail-load-error",
}: YouTubeThumbnailImageProps) {
  const src = useMemo(() => buildThumbUrl(videoId, format), [videoId, format]);
  const probeUrl = useMemo(() => buildProbeUrl(videoId), [videoId]);
  const [thumbState, setThumbState] = useState<{ videoId: string; state: ThumbState }>(() => ({
    videoId,
    state: thumbnailHealthCache.get(videoId) ?? "unknown",
  }));
  const elementRef = useRef<HTMLImageElement | null>(null);
  const state = thumbState.videoId === videoId ? thumbState.state : thumbnailHealthCache.get(videoId) ?? "unknown";

  useEffect(() => {
    const cached = thumbnailHealthCache.get(videoId);
    if (cached && cached !== "unknown") {
      return;
    }

    let cancelled = false;
    const probe = new Image();

    probe.onload = () => {
      if (cancelled) {
        return;
      }
      thumbnailHealthCache.set(videoId, "ready");
      setThumbState({ videoId, state: "ready" });
    };

    probe.onerror = () => {
      if (cancelled) {
        return;
      }
      thumbnailHealthCache.set(videoId, "broken");
      setThumbState({ videoId, state: "broken" });
    };

    probe.src = probeUrl;

    return () => {
      cancelled = true;
    };
  }, [videoId, probeUrl]);

  useEffect(() => {
    if (state !== "broken") {
      return;
    }

    reportUnavailable(videoId, reportReason);

    const closest = hideClosestSelector
      ? elementRef.current?.closest(hideClosestSelector)
      : null;
    if (closest instanceof HTMLElement) {
      closest.style.display = "none";
      closest.setAttribute("data-thumbnail-broken", "1");
    }
  }, [hideClosestSelector, reportReason, state, videoId]);

  if (state !== "ready") {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={elementRef}
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      onError={() => {
        thumbnailHealthCache.set(videoId, "broken");
        setThumbState({ videoId, state: "broken" });
      }}
    />
  );
}
