"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { isLikelyUnavailableThumbnailDimensions } from "@/lib/youtube-thumbnail-health";

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
  const brokenMarkerRef = useRef<HTMLSpanElement | null>(null);
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

      // YouTube fallback placeholders for unavailable videos can still load
      // as tiny 120x90 images. Treat these as broken so cards are excluded.
      const isLikelyUnavailablePlaceholder = isLikelyUnavailableThumbnailDimensions(
        probe.naturalWidth,
        probe.naturalHeight,
      );
      if (isLikelyUnavailablePlaceholder) {
        thumbnailHealthCache.set(videoId, "broken");
        setThumbState({ videoId, state: "broken" });
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

    const anchorElement = elementRef.current ?? brokenMarkerRef.current;
    const closest = hideClosestSelector && anchorElement
      ? anchorElement.closest(hideClosestSelector)
      : null;
    if (closest instanceof HTMLElement) {
      closest.style.display = "none";
      closest.setAttribute("data-thumbnail-broken", "1");
    }
  }, [hideClosestSelector, reportReason, state, videoId]);

  if (state === "broken") {
    return <span ref={brokenMarkerRef} aria-hidden="true" style={{ display: "none" }} />;
  }

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
      onError={(event) => {
        const target = event.currentTarget;
        if (hideClosestSelector) {
          const closest = target.closest(hideClosestSelector);
          if (closest instanceof HTMLElement) {
            closest.style.display = "none";
            closest.setAttribute("data-thumbnail-broken", "1");
          }
        }
        reportUnavailable(videoId, reportReason);
        thumbnailHealthCache.set(videoId, "broken");
        setThumbState({ videoId, state: "broken" });
      }}
    />
  );
}
