"use client";

import { useCallback, useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type PublicPerformancePayload = {
  meta?: { generatedAt?: string };
  host?: {
    cpuUsagePercent?: number | null;
    cpuAverageUsagePercent?: number | null;
    cpuPeakCoreUsagePercent?: number | null;
    memoryUsagePercent?: number | null;
    diskUsagePercent?: number | null;
    swapUsagePercent?: number | null;
    networkUsagePercent?: number | null;
  };
  runtime?: {
    node?: {
      uptimeSec?: number;
      rssMb?: number;
      heapUsedMb?: number;
      heapTotalMb?: number;
    };
    prisma?: {
      windowSec?: number;
      totalQueries?: number;
      queriesPerSec?: number;
      avgDurationMs?: number;
      p95DurationMs?: number;
      totalsSinceBoot?: {
        totalQueries?: number;
        totalDurationMs?: number;
      };
      topOperations?: Array<{
        operation: string;
        count: number;
        totalDurationMs: number;
        avgDurationMs: number;
        p95DurationMs: number;
      }>;
      topQueryFingerprints?: Array<{
        fingerprint: string;
        count: number;
        totalDurationMs: number;
        avgDurationMs: number;
        p95DurationMs: number;
      }>;
    };
  };
};

export type PerformanceMetricsState = {
  isPerformanceQuickLaunchVisible: boolean;
  isPerformanceModalOpen: boolean;
  setIsPerformanceModalOpen: (open: boolean) => void;
  performanceMetrics: PublicPerformancePayload["host"] | null;
  performanceRuntime: PublicPerformancePayload["runtime"] | null;
  performanceMetricsGeneratedAt: string | null;
  isLoadingPerformanceMetrics: boolean;
  performanceMetricsError: string | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

const PUBLIC_PERFORMANCE_POLL_MS = 2_500;

// ── Hook ───────────────────────────────────────────────────────────────────

export function usePerformanceMetrics({
  isShellInitialUiSettled,
}: {
  isShellInitialUiSettled: boolean;
}): PerformanceMetricsState {
  const [isPerformanceQuickLaunchVisible, setIsPerformanceQuickLaunchVisible] = useState(false);
  const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState(false);
  const [performanceMetrics, setPerformanceMetrics] = useState<PublicPerformancePayload["host"] | null>(null);
  const [performanceRuntime, setPerformanceRuntime] = useState<PublicPerformancePayload["runtime"] | null>(null);
  const [performanceMetricsGeneratedAt, setPerformanceMetricsGeneratedAt] = useState<string | null>(null);
  const [isLoadingPerformanceMetrics, setIsLoadingPerformanceMetrics] = useState(false);
  const [performanceMetricsError, setPerformanceMetricsError] = useState<string | null>(null);

  // Reveal the quick-launch button only after the shell UI has settled.
  useEffect(() => {
    if (isPerformanceQuickLaunchVisible) {
      return;
    }

    if (isShellInitialUiSettled) {
      setIsPerformanceQuickLaunchVisible(true);
    }
  }, [isPerformanceQuickLaunchVisible, isShellInitialUiSettled]);

  const loadPublicPerformanceMetrics = useCallback(async () => {
    setIsLoadingPerformanceMetrics(true);

    try {
      const response = await fetch("/api/status/performance", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("performance-metrics-load-failed");
      }

      const payload = (await response.json()) as PublicPerformancePayload;
      setPerformanceMetrics(payload.host ?? null);
      setPerformanceRuntime(payload.runtime ?? null);
      setPerformanceMetricsGeneratedAt(payload.meta?.generatedAt ?? null);
      setPerformanceMetricsError(null);
    } catch {
      setPerformanceMetricsError("Performance metrics are temporarily unavailable.");
      setPerformanceRuntime(null);
    } finally {
      setIsLoadingPerformanceMetrics(false);
    }
  }, []);

  // Poll metrics while the modal is open, pausing when the tab is hidden.
  useEffect(() => {
    if (!isPerformanceModalOpen) {
      return;
    }

    const pollPerformanceMetrics = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void loadPublicPerformanceMetrics();
    };

    pollPerformanceMetrics();
    const intervalId = window.setInterval(() => {
      pollPerformanceMetrics();
    }, PUBLIC_PERFORMANCE_POLL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadPublicPerformanceMetrics();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isPerformanceModalOpen, loadPublicPerformanceMetrics]);

  // Close the modal on Escape.
  useEffect(() => {
    if (!isPerformanceModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPerformanceModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isPerformanceModalOpen]);

  return {
    isPerformanceQuickLaunchVisible,
    isPerformanceModalOpen,
    setIsPerformanceModalOpen,
    performanceMetrics,
    performanceRuntime,
    performanceMetricsGeneratedAt,
    isLoadingPerformanceMetrics,
    performanceMetricsError,
  };
}
