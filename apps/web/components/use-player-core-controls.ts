"use client";

import { useCallback, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

type CorePlayer = {
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
};

export function usePlayerCoreControls({
  playerRef,
  isPlaying,
  setShowEndedChoiceOverlay,
  hasUserGesturePlaybackUnlockRef,
  notePlayAttempt,
  resetPlaybackStallWatchdog,
  setCurrentTime,
  toSafeNumber,
  persistMutedPreferenceOnNextSyncRef,
  setVolume,
  setIsMuted,
  isMuted,
  lastNonZeroVolumeRef,
  volumeRef,
}: {
  playerRef: MutableRefObject<CorePlayer | null>;
  isPlaying: boolean;
  setShowEndedChoiceOverlay: Dispatch<SetStateAction<boolean>>;
  hasUserGesturePlaybackUnlockRef: MutableRefObject<boolean>;
  notePlayAttempt: () => void;
  resetPlaybackStallWatchdog: (overrideTime?: number | null) => void;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  toSafeNumber: (value: unknown, fallback?: number) => number;
  persistMutedPreferenceOnNextSyncRef: MutableRefObject<boolean>;
  setVolume: Dispatch<SetStateAction<number>>;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  isMuted: boolean;
  lastNonZeroVolumeRef: MutableRefObject<number>;
  volumeRef: MutableRefObject<number>;
}) {
  const handlePlayPause = useCallback(() => {
    if (!playerRef.current) return;
    setShowEndedChoiceOverlay(false);
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      hasUserGesturePlaybackUnlockRef.current = true;
      notePlayAttempt();
      playerRef.current.playVideo();
    }
  }, [hasUserGesturePlaybackUnlockRef, isPlaying, notePlayAttempt, playerRef, setShowEndedChoiceOverlay]);

  const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (!playerRef.current) return;
    const seconds = toSafeNumber(Number(event.target.value), 0);
    playerRef.current.seekTo(seconds, true);
    setCurrentTime(seconds);
    resetPlaybackStallWatchdog(seconds);
  }, [playerRef, resetPlaybackStallWatchdog, setCurrentTime, toSafeNumber]);

  const handleVolumeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const vol = toSafeNumber(Number(event.target.value), 0);

    persistMutedPreferenceOnNextSyncRef.current = true;
    setVolume(vol);
    setIsMuted(vol <= 0);

    if (!playerRef.current) {
      return;
    }

    playerRef.current.setVolume(vol);
  }, [persistMutedPreferenceOnNextSyncRef, playerRef, setIsMuted, setVolume, toSafeNumber]);

  const handleMuteToggle = useCallback(() => {
    if (!playerRef.current) return;
    persistMutedPreferenceOnNextSyncRef.current = true;
    if (isMuted) {
      const restoredVolume = Math.max(1, toSafeNumber(lastNonZeroVolumeRef.current, 100));
      playerRef.current.setVolume(restoredVolume);
      setVolume(restoredVolume);
      setIsMuted(false);
    } else {
      const currentVolume = Math.max(0, toSafeNumber(volumeRef.current, 100));
      if (currentVolume > 0) {
        lastNonZeroVolumeRef.current = currentVolume;
      }
      playerRef.current.setVolume(0);
      setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, lastNonZeroVolumeRef, persistMutedPreferenceOnNextSyncRef, playerRef, setIsMuted, setVolume, toSafeNumber, volumeRef]);

  return {
    handlePlayPause,
    handleSeek,
    handleVolumeChange,
    handleMuteToggle,
  };
}
