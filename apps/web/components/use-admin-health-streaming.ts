import { useEffect, useRef } from "react";

const HEALTH_FALLBACK_POLL_MS = 2_000;

type AdminHealthStreamPayload = {
  meta?: { generatedAt?: string };
  health?: {
    nodeUptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
    host: {
      platform: string;
      loadAvg: number[];
      totalMemMb: number;
      freeMemMb: number;
      cpuUsagePercent: number | null;
      cpuAverageUsagePercent: number | null;
      cpuPeakCoreUsagePercent: number | null;
      memoryUsagePercent: number;
      diskUsagePercent: number | null;
      swapUsagePercent: number | null;
      networkUsagePercent: number | null;
    };
  };
};

type UseAdminHealthStreamingOptions = {
  activeTab: string;
  onHealthPayload: (payload: AdminHealthStreamPayload) => void;
};

export function useAdminHealthStreaming({ activeTab, onHealthPayload }: UseAdminHealthStreamingOptions): void {
  const onHealthPayloadRef = useRef(onHealthPayload);

  useEffect(() => {
    onHealthPayloadRef.current = onHealthPayload;
  }, [onHealthPayload]);

  useEffect(() => {
    if (activeTab !== "overview") {
      return;
    }

    let cancelled = false;
    let lastStreamMessageAt = 0;

    const refreshHealth = async () => {
      try {
        const response = await fetch("/api/admin/dashboard/health");
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as AdminHealthStreamPayload;
        if (!cancelled && payload?.health) {
          onHealthPayloadRef.current(payload);
        }
      } catch {
        // Ignore polling failures and keep the last known state.
      }
    };

    const stream = new EventSource("/api/admin/dashboard/stream");

    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as AdminHealthStreamPayload;
        if (!payload?.health || cancelled) {
          return;
        }

        lastStreamMessageAt = Date.now();
        onHealthPayloadRef.current(payload);
      } catch {
        // Ignore malformed payloads.
      }
    };

    stream.onerror = () => {
      void refreshHealth();
    };

    void refreshHealth();

    const pollingTimer = window.setInterval(() => {
      if (Date.now() - lastStreamMessageAt > HEALTH_FALLBACK_POLL_MS * 2) {
        void refreshHealth();
      }
    }, HEALTH_FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollingTimer);
      stream.close();
    };
  }, [activeTab]);
}
