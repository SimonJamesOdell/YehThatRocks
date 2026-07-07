"use client";

import { useEffect, useRef, useState } from "react";
import type { YouTubePlayerHandle } from "@/components/mobile/mobile-player-context";

type MobileYouTubePlayerProps = {
  videoId: string;
  onReady?: () => void;
  onEnd?: () => void;
  onError?: () => void;
  playerApiRef: React.MutableRefObject<YouTubePlayerHandle | null>;
  style?: React.CSSProperties;
};

type YTPlayer = any;

// Runtime YouTube IFrame API globals loaded by YouTubeIframeApiLoader
declare const YT: {
  Player: new (
    el: HTMLElement,
    cfg: {
      videoId: string;
      playerVars: Record<string, number>;
      events: Record<string, (...args: unknown[]) => void>;
    },
  ) => YTPlayer;
  PlayerState: {
    ENDED: number;
  };
} | undefined;

export function MobileYouTubePlayer({
  videoId,
  onReady,
  onEnd,
  onError,
  playerApiRef,
  style,
}: MobileYouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const videoIdRef = useRef(videoId);
  videoIdRef.current = videoId;

  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | null = null;

    function init() {
      if (cancelled || !containerRef.current) return;
      if (typeof YT === "undefined" || !YT?.Player) return;

      player = new YT.Player(containerRef.current, {
        videoId: videoIdRef.current,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          cc_load_policy: 3,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            playerApiRef.current = player as unknown as YouTubePlayerHandle;
            setLoadState("ready");
            onReady?.();
          },
          onError: () => {
            if (cancelled) return;
            setLoadState("error");
            onError?.();
          },
          onStateChange: (event: { data: number }) => {
            if (cancelled) return;
            if (YT?.PlayerState && event.data === YT.PlayerState.ENDED) {
              onEnd?.();
            }
          },
        },
      } as YTPlayer);
    }

    if (typeof YT !== "undefined" && YT?.Player) {
      init();
    } else {
      const check = setInterval(() => {
        if (typeof YT !== "undefined" && YT?.Player) {
          clearInterval(check);
          init();
        }
      }, 200);
      return () => {
        clearInterval(check);
        cancelled = true;
        try { player?.destroy?.(); } catch { /* already unmounted */ }
        playerApiRef.current = null;
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }
      };
    }

    return () => {
      cancelled = true;
      try { player?.destroy?.(); } catch { /* already unmounted */ }
      playerApiRef.current = null;
      // YouTube's destroy() removes the iframe; clear the container so React
      // doesn't trip over a node that's already been removed from the DOM.
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [videoId, onReady, onEnd, onError, playerApiRef]);

  if (loadState === "error") {
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", background: "#111", color: "#999" }}>
        <p>This video is unavailable.</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", ...style }}>
      {loadState === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#111",
            color: "#999",
            zIndex: 1,
          }}
        >
          <p>Loading player...</p>
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}