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

type AdminCpuDialPayload = {
  generatedAt?: string;
  cpuUsagePercent?: number | null;
  cpuAverageUsagePercent?: number | null;
  cpuPeakCoreUsagePercent?: number | null;
};

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function mergeCpuDialIntoHealthPayload(
  currentPayload: AdminHealthStreamPayload,
  cpuPayload: AdminCpuDialPayload,
): AdminHealthStreamPayload {
  const health = currentPayload.health;
  if (!health) {
    return currentPayload;
  }

  return {
    ...currentPayload,
    meta: {
      ...currentPayload.meta,
      generatedAt: cpuPayload.generatedAt ?? currentPayload.meta?.generatedAt,
    },
    health: {
      ...health,
      host: {
        ...health.host,
        cpuUsagePercent: finiteOrNull(cpuPayload.cpuUsagePercent),
        cpuAverageUsagePercent: finiteOrNull(cpuPayload.cpuAverageUsagePercent),
        cpuPeakCoreUsagePercent: finiteOrNull(cpuPayload.cpuPeakCoreUsagePercent),
      },
    },
  };
}

type UseAdminHealthStreamingOptions = {
  activeTab: string;
  onHealthPayload: (payload: AdminHealthStreamPayload) => void;
};

export function useAdminHealthStreaming({ activeTab, onHealthPayload }: UseAdminHealthStreamingOptions): void {
  const onHealthPayloadRef = useRef(onHealthPayload);
  const lastHealthPayloadRef = useRef<AdminHealthStreamPayload | null>(null);

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
        lastHealthPayloadRef.current = payload;
        onHealthPayloadRef.current(payload);
      } catch {
        // Ignore malformed payloads.
      }
    };

    const handleCpuMessage = (event: MessageEvent<string>) => {
      try {
        if (cancelled || !lastHealthPayloadRef.current?.health) {
          return;
        }

        const cpuPayload = JSON.parse(event.data) as AdminCpuDialPayload;
        lastStreamMessageAt = Date.now();
        const mergedPayload = mergeCpuDialIntoHealthPayload(lastHealthPayloadRef.current, cpuPayload);
        lastHealthPayloadRef.current = mergedPayload;
        onHealthPayloadRef.current(mergedPayload);
      } catch {
        // Ignore malformed CPU payloads.
      }
    };

    stream.addEventListener("cpu", handleCpuMessage as EventListener);

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
      stream.removeEventListener("cpu", handleCpuMessage as EventListener);
      stream.close();
    };
  }, [activeTab]);
}
