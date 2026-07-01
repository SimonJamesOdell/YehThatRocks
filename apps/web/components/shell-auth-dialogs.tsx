"use client";

import { AuthUnavailableDialog } from "@/components/auth-unavailable-dialog";
import { CurrentVideoRetryDialog } from "@/components/current-video-retry-dialog";

interface ShellAuthDialogsProps {
  authStatus: "clear" | "unavailable";
  authStatusMessage: string | null;
  isAuthUnavailableDialogRequested: boolean;
  isAuthUnavailableDialogDismissed: boolean;
  isRetryingAuthStatus: boolean;
  onAuthDismiss: () => void;
  onAuthRetry: () => void;
  requestedVideoId: string | null;
  isResolvingRequestedVideo: boolean;
  requestedVideoPendingRetryAfterMs: number | null;
  requestedVideoPendingReason: "cooldown" | "concurrency-shed" | "timeout" | "resolver-error" | null | undefined;
  onVideoRetryNow: () => void;
}

export function ShellAuthDialogs({
  authStatus,
  authStatusMessage,
  isAuthUnavailableDialogRequested,
  isAuthUnavailableDialogDismissed,
  isRetryingAuthStatus,
  onAuthDismiss,
  onAuthRetry,
  requestedVideoId,
  isResolvingRequestedVideo,
  requestedVideoPendingRetryAfterMs,
  requestedVideoPendingReason,
  onVideoRetryNow,
}: ShellAuthDialogsProps) {
  return (
    <>
      {authStatus === "unavailable" && authStatusMessage && isAuthUnavailableDialogRequested && !isAuthUnavailableDialogDismissed ? (
        <AuthUnavailableDialog
          message={authStatusMessage}
          isRetrying={isRetryingAuthStatus}
          retryLabel="Retry auth now"
          retryButtonLabel="Try again"
          retryBusyLabel="Trying again..."
          dismissLabel="Dismiss auth availability notice"
          dismissButtonLabel="Dismiss"
          onRetry={onAuthRetry}
          onDismiss={onAuthDismiss}
        />
      ) : null}
      {requestedVideoId && isResolvingRequestedVideo && requestedVideoPendingRetryAfterMs !== null ? (
        <CurrentVideoRetryDialog
          pendingReason={requestedVideoPendingReason}
          retryAfterMs={requestedVideoPendingRetryAfterMs}
          onRetryNow={onVideoRetryNow}
        />
      ) : null}
    </>
  );
}
