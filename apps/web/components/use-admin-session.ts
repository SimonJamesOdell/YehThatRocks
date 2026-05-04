"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

const ADMIN_SESSION_REVALIDATE_INTERVAL_MS = 30_000;

export function useAdminSession({
  isLoggedIn,
  initialIsAdmin,
}: {
  isLoggedIn: boolean;
  initialIsAdmin: boolean;
}): boolean {
  const [isAdminSessionActive, setIsAdminSessionActive] = useState(initialIsAdmin);

  useEffect(() => {
    setIsAdminSessionActive(initialIsAdmin);
  }, [initialIsAdmin]);

  const revalidateAdminSession = useCallback(async () => {
    if (!isLoggedIn) {
      setIsAdminSessionActive(false);
      return;
    }

    try {
      const response = await fetchWithAuthRetry("/api/admin/dashboard", {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        setIsAdminSessionActive(true);
        return;
      }

      if (response.status === 401 || response.status === 403) {
        setIsAdminSessionActive(false);
      }
    } catch {
      // Keep current capability state on transient network failures.
    }
  }, [isLoggedIn]);

  useEffect(() => {
    void revalidateAdminSession();
  }, [revalidateAdminSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleFocus = () => {
      void revalidateAdminSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void revalidateAdminSession();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void revalidateAdminSession();
      }
    }, ADMIN_SESSION_REVALIDATE_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [revalidateAdminSession]);

  return isLoggedIn && isAdminSessionActive;
}
