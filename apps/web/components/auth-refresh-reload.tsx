"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rendered when a server component detects no valid access token but a
 * refresh token cookie was present. Silently calls the refresh endpoint and
 * reloads the page so the server component gets a fresh access token.
 */
export function AuthRefreshReload() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const tryRefresh = async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });

        if (!cancelled && res.ok) {
          window.dispatchEvent(new Event("ytr:auth-success"));
          router.refresh();
        }
      } catch {
        // Refresh failed — leave the login prompt visible.
      }
    };

    void tryRefresh();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
