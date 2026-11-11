"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { EVENT_NAMES, dispatchAppEvent } from "@/lib/events-contract";
import { publishAuthStateChange } from "@/lib/auth-sync";
import { refreshAuthSession } from "@/lib/client-auth-fetch";

/**
 * Rendered when a server component detects no valid access token but a
 * refresh token cookie was present. Silently calls the refresh endpoint and
 * reloads the page so the server component gets a fresh access token.
 *
 * Uses the shared, hardened refreshAuthSession helper, so a Cloudflare
 * bot-fight / Under Attack Mode HTML challenge is classified as "unavailable"
 * rather than being mistaken for a successful refresh (which previously
 * published an "authenticated" state and refreshed with stale cookies).
 */
export function AuthRefreshReload() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const tryRefresh = async () => {
      const result = await refreshAuthSession();

      if (!cancelled && result === "ok") {
        dispatchAppEvent(EVENT_NAMES.AUTH_SUCCESS, null);
        publishAuthStateChange("authenticated");
        router.refresh();
      }
    };

    void tryRefresh();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
