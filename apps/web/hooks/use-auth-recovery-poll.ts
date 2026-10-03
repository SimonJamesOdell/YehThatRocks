"use client";

import { useEffect } from "react";
import { AUTO_LOGIN_SUPPRESS_ONCE_KEY } from "@/lib/storage-keys";
import { refreshAuthSession } from "@/lib/client-auth-fetch";

/**
 * When checkAuthState detects auth loss (not explicit logout), this hook
 * keeps trying a silent refresh so a transient failure doesn't force a manual
 * re-login.  Explicit logout sets AUTO_LOGIN_SUPPRESS_ONCE_KEY in
 * sessionStorage, which this hook checks before attempting recovery.
 *
 * The refresh goes through the shared, deduplicated, backoff-guarded
 * refreshAuthSession helper (rather than a raw fetch) so this poll can never
 * race the shell's own auth probe or hammer the token-rotation endpoint.
 *
 * A definitive "unauthorized" verdict means the refresh token is
 * invalid/expired/revoked and the server has already cleared the auth
 * cookies — nothing is left to recover, so the poll stops instead of retrying
 * a dead session forever.
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
    let gaveUp = false;

    const stopRecovery = () => {
      try { window.sessionStorage.removeItem("ytr:auth-recovery"); } catch { /* ignore */ }
    };

    const attemptRecovery = async () => {
      if (cancelled || gaveUp) {
        return;
      }
      if (window.sessionStorage.getItem(AUTO_LOGIN_SUPPRESS_ONCE_KEY) === "1") {
        // User explicitly signed out — stop recovery.
        stopRecovery();
        return;
      }

      const result = await refreshAuthSession();

      if (cancelled || gaveUp) {
        return;
      }

      if (result === "ok") {
        onRecoverySuccess();
        return;
      }

      if (result === "unauthorized") {
        // Definitive sign-out: the refresh token is dead and the cookies have
        // been cleared. Retrying can never succeed, so stop the poll.
        gaveUp = true;
        stopRecovery();
      }
      // "unavailable" / "blocked" are transient — retry on the next tick.
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
