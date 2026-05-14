/**
 * Hook for polling admin dashboard data on demand.
 * The admin panel calls this when opened and can stop polling when closed.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type AdminDashboardPayload = {
  ok: boolean;
  error?: string;
  meta?: {
    durationMs: number;
    generatedAt: string;
    computedAtMs: number;
  };
  counts?: {
    users: number;
    registeredUsers: number;
    anonymousUsers: number;
    videos: number;
    artists: number;
    categories: number;
  };
  [key: string]: unknown;
};

type UseAdminDashboardPollingOptions = {
  /**
   * Poll interval in milliseconds. Default: 30000 (30 seconds)
   */
  intervalMs?: number;
  /**
   * Whether polling is enabled. When false, polling stops and clears.
   */
  enabled?: boolean;
  /**
   * Called when data is fetched successfully
   */
  onSuccess?: (payload: AdminDashboardPayload) => void;
  /**
   * Called when an error occurs
   */
  onError?: (error: Error) => void;
};

export function useAdminDashboardPolling(options: UseAdminDashboardPollingOptions = {}) {
  const {
    intervalMs = 30_000,
    enabled = true,
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState<AdminDashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/admin/dashboard", {
        headers: {
          "Accept": "application/json",
        },
      });

      if (!isMountedRef.current) return;

      if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`);
      }

      const payload = (await response.json()) as AdminDashboardPayload;

      if (!isMountedRef.current) return;

      setData(payload);
      setLastFetchedAt(Date.now());
      onSuccess?.(payload);
    } catch (err) {
      if (!isMountedRef.current) return;

      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [onSuccess, onError]);

  // Set up polling when enabled
  useEffect(() => {
    if (!enabled) {
      // Stop polling if disabled
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Fetch immediately when enabled
    void fetchData();

    // Set up interval polling
    timerRef.current = setInterval(() => {
      void fetchData();
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, intervalMs, fetchData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const refetch = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return {
    data,
    isLoading,
    error,
    lastFetchedAt,
    refetch,
  };
}
