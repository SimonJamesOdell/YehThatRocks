import { useEffect } from "react";

type UseAdminApiTabPollingOptions = {
  activeTab: string;
  quotaStatus: { msUntilReset: number; recommendedBudget: number } | null;
  onTickMsUntilReset: (update: (prev: number | null) => number | null) => void;
  onLoadQuotaStatus: () => Promise<void>;
  onTriggerBackfill: (budgetUnits: number) => Promise<void>;
};

export function useAdminApiTabPolling({
  activeTab,
  quotaStatus,
  onTickMsUntilReset,
  onLoadQuotaStatus,
  onTriggerBackfill,
}: UseAdminApiTabPollingOptions): void {
  useEffect(() => {
    if (activeTab !== "api") {
      return;
    }

    const POLL_INTERVAL_MS = 60_000;
    const AUTO_TRIGGER_MS = 120_000; // 2 minutes before reset
    let autoTriggered = false;

    const tick = () => {
      onTickMsUntilReset((prev) => (prev !== null ? Math.max(0, prev - 1000) : prev));
    };

    const tickInterval = window.setInterval(tick, 1_000);

    const pollInterval = window.setInterval(() => {
      void onLoadQuotaStatus();
    }, POLL_INTERVAL_MS);

    // Auto-trigger check
    const autoCheckInterval = window.setInterval(() => {
      if (
        !autoTriggered &&
        quotaStatus &&
        quotaStatus.msUntilReset <= AUTO_TRIGGER_MS &&
        quotaStatus.recommendedBudget >= 500
      ) {
        autoTriggered = true;
        void onTriggerBackfill(quotaStatus.recommendedBudget);
      }
    }, 5_000);

    return () => {
      window.clearInterval(tickInterval);
      window.clearInterval(pollInterval);
      window.clearInterval(autoCheckInterval);
    };
  }, [activeTab, quotaStatus, onTickMsUntilReset, onLoadQuotaStatus, onTriggerBackfill]);
}
