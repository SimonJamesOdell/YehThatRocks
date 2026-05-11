import { useEffect, useRef } from "react";

type UseAdminVideoQueuePollingOptions = {
  activeTab: string;
  onRefresh: () => Promise<void>;
};

export function useAdminVideoQueuePolling({ activeTab, onRefresh }: UseAdminVideoQueuePollingOptions): void {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (activeTab !== "videos" && activeTab !== "catalog-review") {
      return;
    }

    let authErrorRetries = 0;
    const MAX_AUTH_ERROR_RETRIES = 2;
    const AUTH_ERROR_RETRY_DELAY_MS = 1200;
    const VIDEOS_TAB_POLL_MS = 8_000;

    let authRetryTimeoutId: number | null = null;

    const refreshVideoModerationQueues = async () => {
      try {
        await refreshRef.current();
        authErrorRetries = 0; // Reset on success
      } catch (pollError) {
        const isAuthError = pollError instanceof Error && (pollError.message.includes("401") || pollError.message.includes("Unauthorized"));
        if (isAuthError && authErrorRetries < MAX_AUTH_ERROR_RETRIES) {
          authErrorRetries += 1;
          authRetryTimeoutId = window.setTimeout(() => {
            void refreshVideoModerationQueues();
          }, AUTH_ERROR_RETRY_DELAY_MS);
        }
        // Keep the current admin data visible on transient polling failures.
      }
    };

    void refreshVideoModerationQueues();
    const intervalId = window.setInterval(() => {
      void refreshVideoModerationQueues();
    }, VIDEOS_TAB_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
      if (authRetryTimeoutId !== null) {
        window.clearTimeout(authRetryTimeoutId);
      }
    };
  }, [activeTab]);
}
