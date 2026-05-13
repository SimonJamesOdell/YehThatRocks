type BasicPlayerControls = {
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
};

export function executePlayPauseControl({
  player,
  isPlaying,
  onHideEndedChoiceOverlay,
  onPlaybackUnlock,
  onPlayAttempt,
}: {
  player: BasicPlayerControls | null;
  isPlaying: boolean;
  onHideEndedChoiceOverlay: () => void;
  onPlaybackUnlock: () => void;
  onPlayAttempt: () => void;
}) {
  if (!player) {
    return;
  }

  onHideEndedChoiceOverlay();

  if (isPlaying) {
    player.pauseVideo();
    return;
  }

  onPlaybackUnlock();
  onPlayAttempt();
  player.playVideo();
}

export function executeSeekControl({
  player,
  rawValue,
  toSafeNumber,
  setCurrentTime,
  resetPlaybackStallWatchdog,
}: {
  player: BasicPlayerControls | null;
  rawValue: number;
  toSafeNumber: (value: unknown, fallback?: number) => number;
  setCurrentTime: (seconds: number) => void;
  resetPlaybackStallWatchdog: (lastTime?: number | null) => void;
}) {
  if (!player) {
    return;
  }

  const seconds = toSafeNumber(rawValue, 0);
  player.seekTo(seconds, true);
  setCurrentTime(seconds);
  resetPlaybackStallWatchdog(seconds);
}

export function executeVolumeChangeControl({
  player,
  rawValue,
  toSafeNumber,
  onPersistMutedPreference,
  setVolume,
  setIsMuted,
}: {
  player: BasicPlayerControls | null;
  rawValue: number;
  toSafeNumber: (value: unknown, fallback?: number) => number;
  onPersistMutedPreference: () => void;
  setVolume: (volume: number) => void;
  setIsMuted: (isMuted: boolean) => void;
}) {
  const volume = toSafeNumber(rawValue, 0);

  onPersistMutedPreference();
  setVolume(volume);
  setIsMuted(volume <= 0);

  if (!player) {
    return;
  }

  player.setVolume(volume);
}

export function executeMuteToggleControl({
  player,
  isMuted,
  lastNonZeroVolume,
  currentVolume,
  toSafeNumber,
  onPersistMutedPreference,
  setLastNonZeroVolume,
  setVolume,
  setIsMuted,
}: {
  player: BasicPlayerControls | null;
  isMuted: boolean;
  lastNonZeroVolume: number;
  currentVolume: number;
  toSafeNumber: (value: unknown, fallback?: number) => number;
  onPersistMutedPreference: () => void;
  setLastNonZeroVolume: (volume: number) => void;
  setVolume: (volume: number) => void;
  setIsMuted: (isMuted: boolean) => void;
}) {
  if (!player) {
    return;
  }

  onPersistMutedPreference();

  if (isMuted) {
    const restoredVolume = Math.max(1, toSafeNumber(lastNonZeroVolume, 100));
    player.setVolume(restoredVolume);
    setVolume(restoredVolume);
    setIsMuted(false);
    return;
  }

  const safeCurrentVolume = Math.max(0, toSafeNumber(currentVolume, 100));
  if (safeCurrentVolume > 0) {
    setLastNonZeroVolume(safeCurrentVolume);
  }

  player.setVolume(0);
  setVolume(0);
  setIsMuted(true);
}

export function executeWatchAgainControl({
  player,
  onPlaybackUnlock,
  onPlayAttempt,
}: {
  player: BasicPlayerControls | null;
  onPlaybackUnlock: () => void;
  onPlayAttempt: () => void;
}) {
  if (!player) {
    return;
  }

  player.seekTo(0, true);
  onPlaybackUnlock();
  onPlayAttempt();
  player.playVideo();
}
