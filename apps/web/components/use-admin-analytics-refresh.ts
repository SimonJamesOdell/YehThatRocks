import { useEffect } from "react";

const ANALYTICS_AUTO_REFRESH_MS = 5 * 60 * 1000;

type UseAdminAnalyticsRefreshOptions = {
  activeTab: string;
  onRefresh: () => Promise<void>;
};

export function useAdminAnalyticsRefresh({ activeTab, onRefresh }: UseAdminAnalyticsRefreshOptions): void {
  useEffect(() => {
    if (activeTab !== "overview") {
      return;
    }

    let cancelled = false;
    let refreshing = false;

    const refreshIfVisible = async () => {
      if (cancelled || refreshing || document.hidden) {
        return;
      }

      refreshing = true;
      try {
        await onRefresh();
      } catch {
        // Keep last known data; manual refresh remains available.
      } finally {
        refreshing = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshIfVisible();
    }, ANALYTICS_AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeTab, onRefresh]);
}
