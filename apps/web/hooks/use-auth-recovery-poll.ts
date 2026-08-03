"use client";

import { useEffect } from "react";
import { AUTO_LOGIN_SUPPRESS_ONCE_KEY } from "@/lib/storage-keys";

/**
 * When checkAuthState detects auth loss (not explicit logout), this hook
 * keeps trying a silent /api/auth/refresh every 30 s so a transient failure
 * doesn't force a manual re-login.  Explicit logout sets
 * AUTO_LOGIN_SUPPRESS_ONCE_KEY in sessionStorage, which this hook checks
 * before attempting recovery.
 */
export function useAuthRecoveryPoll({
  isAuthenticated,
  onRecoverySuccess,
}: {
  isAuthenticated: boolean;
  onRecoverySuccess: () => void;
}) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (isAuthenticated) {
      return;
    }
    if (window.sessionStorage.getItem("ytr:auth-recovery") !== "1") {
      return;
    }
    let cancelled = false;
    const attemptRecovery = async () => {
      if (window.sessionStorage.getItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY) === "1") {
        // User explicitly signed out — stop recovery.
        try { window.sessionStorage.removeItem("ytr:auth-recovery"); } catch { /* ignore */ }
        return;
      }
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!cancelled && res.ok) {
          onRecoverySuccess();
        }
      } catch {
        // Transient — will retry on the next interval tick.
      }
    };
    void attemptRecovery();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void attemptRecovery();
    }, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void attemptRecovery();
      }
    };
    const onWindowOnline = () => {
      void attemptRecovery();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onWindowOnline);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onWindowOnline);
    };
  }, [isAuthenticated, onRecoverySuccess]);
}