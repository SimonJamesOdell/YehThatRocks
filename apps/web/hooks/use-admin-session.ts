"use client";

import { useCallback, useEffect, useState } from "react";

import { refreshAuthSession } from "@/lib/client-auth-fetch";

const ADMIN_SESSION_REVALIDATE_INTERVAL_MS = 30_000;
// Refresh the access token well before its 15-minute expiry so an open admin
// panel never falls into the 401 window during active use.
const ADMIN_SESSION_PROACTIVE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

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
      const response = await fetch("/api/admin/dashboard", {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        setIsAdminSessionActive(true);
        return;
      }

      if (response.status === 401 || response.status === 403) {
        const refreshResult = await refreshAuthSession();

        if (refreshResult === "ok") {
          const retryResponse = await fetch("/api/admin/dashboard", {
            method: "GET",
            cache: "no-store",
          });

          if (retryResponse.ok) {
            setIsAdminSessionActive(true);
          }

          // Refresh succeeded but the endpoint still rejects: a server-side
          // anomaly, not a sign-out. Keep the current capability state.
          return;
        }

        if (refreshResult === "unauthorized") {
          // Definitive sign-out — the refresh token was rejected and the
          // server cleared the auth cookies.
          setIsAdminSessionActive(false);
        }

        // "blocked" / "unavailable": transient failure — keep the current
        // capability state and let the next poll revalidate.
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

  useEffect(() => {
    if (typeof window === "undefined" || !isLoggedIn) {
      return;
    }

    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshAuthSession();
      }
    }, ADMIN_SESSION_PROACTIVE_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(refreshTimer);
  }, [isLoggedIn]);

  return isLoggedIn && isAdminSessionActive;
}
