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

const thumbnailHealthCache = new Map<string, ThumbState>();
const unavailableReportSent = new Set<string>();

function buildThumbUrl(videoId: string, format: "mqdefault" | "hqdefault") {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${format}.jpg`;
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
  const [state, setState] = useState<ThumbState>(() => thumbnailHealthCache.get(src) ?? "unknown");
  const elementRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const cached = thumbnailHealthCache.get(src);
    if (cached && cached !== "unknown") {
      setState(cached);
      return;
    }

    let cancelled = false;
    const probe = new Image();

    probe.onload = () => {
      if (cancelled) {
        return;
      }
      thumbnailHealthCache.set(src, "ready");
      setState("ready");
    };

    probe.onerror = () => {
      if (cancelled) {
        return;
      }
      thumbnailHealthCache.set(src, "broken");
      setState("broken");
    };

    probe.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

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
        thumbnailHealthCache.set(src, "broken");
        setState("broken");
      }}
    />
  );
}
