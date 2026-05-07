"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type EmbedPlayerProps = {
  videoId: string;
  title: string;
  watchUrl: string;
};

type YTPlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  loadVideoById: (videoId: string) => void;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    config: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: { target: YTPlayer }) => void;
        onStateChange?: (event: { data: number; target: YTPlayer }) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: { ENDED: number; PAUSED: number; PLAYING: number; BUFFERING: number };
};

function getYT(): YTNamespace | undefined {
  return (window as Window & { YT?: YTNamespace }).YT;
}

function getOnYouTubeIframeAPIReady(): (() => void) | undefined {
  return (window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady;
}

function setOnYouTubeIframeAPIReady(fn: () => void) {
  (window as Window & { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = fn;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EmbedPlayer({ videoId, title, watchUrl }: EmbedPlayerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const progressIntervalRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const stopProgress = useCallback(() => {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const startProgress = useCallback(() => {
    if (progressIntervalRef.current !== null) return;
    progressIntervalRef.current = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || isScrubbing) return;
      try {
        setCurrentTime(player.getCurrentTime());
        const dur = player.getDuration();
        if (dur > 0) setDuration(dur);
      } catch {
        /* ignore */
      }
    }, 250);
  }, [isScrubbing]);

  useEffect(() => {
    let destroyed = false;

    function createPlayer() {
      if (!mountRef.current || !getYT()?.Player || destroyed) return;

      const player = new (getYT() as YTNamespace).Player(mountRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          controls: 0,
          rel: 0,
          iv_load_policy: 3,
          enablejsapi: 1,
          origin: window.location.origin,
          playsinline: 1,
          fs: 0,
        },
        events: {
          onReady: (e) => {
            if (destroyed) return;
            setIsReady(true);
            const dur = e.target.getDuration();
            if (dur > 0) setDuration(dur);
            setVolume(e.target.getVolume());
            setIsMuted(e.target.isMuted());
          },
          onStateChange: (e) => {
            if (destroyed || !getYT()?.PlayerState) return;
            const { PlayerState } = getYT() as YTNamespace;
            if (e.data === PlayerState.PLAYING) {
              setIsPlaying(true);
              setHasStarted(true);
              startProgress();
              const dur = e.target.getDuration();
              if (dur > 0) setDuration(dur);
            } else {
              setIsPlaying(false);
              stopProgress();
              try {
                setCurrentTime(e.target.getCurrentTime());
              } catch {
                /* ignore */
              }
            }
          },
        },
      });

      playerRef.current = player;
    }

    if (getYT()?.Player) {
      createPlayer();
    } else {
      const prev = getOnYouTubeIframeAPIReady();
      setOnYouTubeIframeAPIReady(() => {
        prev?.();
        createPlayer();
      });
    }

    return () => {
      destroyed = true;
      stopProgress();
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId, startProgress, stopProgress]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function handlePlayPause() {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    const player = playerRef.current;
    if (!player || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTo = ratio * duration;
    player.seekTo(seekTo, true);
    setCurrentTime(seekTo);
  }

  function handleScrubStart(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    doScrub(e.currentTarget, e.clientX);
  }

  function handleScrubMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isScrubbing) return;
    doScrub(e.currentTarget, e.clientX);
  }

  function handleScrubEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!isScrubbing) return;
    setIsScrubbing(false);
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTo = ratio * duration;
    playerRef.current?.seekTo(seekTo, true);
    setCurrentTime(seekTo);
  }

  function doScrub(element: HTMLElement, clientX: number) {
    if (duration <= 0) return;
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setCurrentTime(ratio * duration);
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value);
    setVolume(val);
    const player = playerRef.current;
    if (!player) return;
    player.setVolume(val);
    if (val === 0) {
      player.mute();
      setIsMuted(true);
    } else if (isMuted) {
      player.unMute();
      setIsMuted(false);
    }
  }

  function handleMuteToggle() {
    const player = playerRef.current;
    if (!player) return;
    if (isMuted) {
      player.unMute();
      setIsMuted(false);
      if (volume === 0) {
        player.setVolume(50);
        setVolume(50);
      }
    } else {
      player.mute();
      setIsMuted(true);
    }
  }

  function handleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {
        /* fallback: browser may block */
      });
    } else {
      document.exitFullscreen().catch(() => {/* ignore */});
    }
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="embedRoot" ref={containerRef}>
      {/* Header */}
      <div className="embedHeader">
        <a className="embedLogo" href={watchUrl} target="_blank" rel="noopener noreferrer">
          <span className="embedLogoText">YehThatRocks</span>
        </a>
        {title ? <span className="embedTitle">{title}</span> : null}
        <a className="embedWatchLink" href={watchUrl} target="_blank" rel="noopener noreferrer">
          Watch on site ↗
        </a>
      </div>

      {/* Player */}
      <div className="embedPlayerArea">
        <div className="embedPlayerMount" ref={mountRef} />
        <div
          className="embedClickLayer"
          onClick={handlePlayPause}
          role="button"
          tabIndex={0}
          aria-label={isPlaying ? "Pause" : "Play"}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              handlePlayPause();
            }
          }}
        >
          <div className={`embedPlayBigBtn${hasStarted || !isReady ? " embedPlayBigBtnHidden" : ""}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="embedControls">
        {/* Scrubber */}
        <div
          className="embedProgress"
          role="slider"
          aria-label="Seek"
          aria-valuenow={Math.round(progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={handleScrubStart}
          onPointerMove={handleScrubMove}
          onPointerUp={handleScrubEnd}
          onPointerCancel={handleScrubEnd}
          onClick={handleSeekClick}
        >
          <div className="embedProgressFill" style={{ width: `${progressPercent}%` }} />
          <div className="embedProgressHandle" style={{ left: `${progressPercent}%` }} />
        </div>

        {/* Button row */}
        <div className="embedControlsRow">
          <button
            className="embedControlBtn"
            onClick={handlePlayPause}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!isReady}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <span className="embedTime">
            {formatTime(currentTime)}&nbsp;/&nbsp;{formatTime(duration)}
          </span>

          <span className="embedSpacer" />

          <div className="embedVolume">
            <button
              className="embedControlBtn"
              onClick={handleMuteToggle}
              aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              className="embedVolumeSlider"
              min={0}
              max={100}
              value={isMuted ? 0 : volume}
              onChange={handleVolume}
              aria-label="Volume"
            />
          </div>

          <button
            className="embedControlBtn"
            onClick={handleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
