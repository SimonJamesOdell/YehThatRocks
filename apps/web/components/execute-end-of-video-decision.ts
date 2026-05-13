import { attemptAutoplayRecovery } from "@/components/attempt-autoplay-recovery";
import type { EndOfVideoDecision } from "@/components/resolve-end-of-video-decision";

type NavigateOptions = {
  clearPlaylist?: boolean;
  playlistId?: string | null;
  playlistItemIndex?: number | null;
};

export function executeEndOfVideoDecision({
  decision,
  currentVideoId,
  activePlaylistId,
  fallbackPoolSize,
  historyStack,
  getNextRecoveryRequestId,
  getCurrentRecoveryRequestId,
  getCurrentVideoId,
  setPendingAutoAdvanceVideoId,
  navigateToVideo,
  showEndedChoiceOverlay,
  setPlayerClosedByEndOfVideo,
}: {
  decision: EndOfVideoDecision;
  currentVideoId: string;
  activePlaylistId: string | null;
  fallbackPoolSize: number;
  historyStack: string[];
  getNextRecoveryRequestId: () => number;
  getCurrentRecoveryRequestId: () => number;
  getCurrentVideoId: () => string;
  setPendingAutoAdvanceVideoId: (videoId: string) => void;
  navigateToVideo: (videoId: string, options?: NavigateOptions) => void;
  showEndedChoiceOverlay: () => void;
  setPlayerClosedByEndOfVideo: (closed: boolean) => void;
}) {
  if (decision.kind === "navigate-next") {
    setPendingAutoAdvanceVideoId(decision.videoId);
    navigateToVideo(decision.videoId, {
      clearPlaylist: decision.clearPlaylist,
      playlistId: activePlaylistId,
      playlistItemIndex: decision.playlistItemIndex,
    });
    return;
  }

  if (decision.kind === "wait-playlist") {
    return;
  }

  if (decision.kind === "recover-route") {
    const requestId = getNextRecoveryRequestId();
    const endedVideoId = currentVideoId;

    void (async () => {
      const recoveryOutcome = await attemptAutoplayRecovery({
        requestId,
        endedVideoId,
        fallbackPoolSize,
        historyStack,
        getCurrentRequestId: getCurrentRecoveryRequestId,
        getCurrentVideoId,
      });

      if (recoveryOutcome.kind === "stale-request" || recoveryOutcome.kind === "stale-video") {
        return;
      }

      if (recoveryOutcome.kind === "show-overlay") {
        showEndedChoiceOverlay();
        return;
      }

      setPendingAutoAdvanceVideoId(recoveryOutcome.videoId);
      navigateToVideo(recoveryOutcome.videoId, {
        clearPlaylist: true,
        playlistId: null,
        playlistItemIndex: null,
      });
    })();

    return;
  }

  if (decision.kind === "close-docked") {
    setPlayerClosedByEndOfVideo(true);
    return;
  }

  if (decision.kind === "show-overlay") {
    setPlayerClosedByEndOfVideo(false);
    showEndedChoiceOverlay();
  }
}
