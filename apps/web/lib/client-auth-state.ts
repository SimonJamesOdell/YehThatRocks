"use client";

import type { RefreshSessionResult } from "@/lib/client-auth-fetch";

export type ClientAuthProbeResult = "authenticated" | "unauthenticated" | "unavailable";

/**
 * Probe /api/auth/me and resolve the client auth state precisely.
 *
 * The caller supplies its own refresh handler so the probe stays independent
 * of the refresh backoff policy. The refresh endpoint's contract is what
 * makes the verdict precise:
 *
 * - "ok":            new tokens issued (or the request raced another tab).
 * - "unauthorized":  the refresh token is invalid/expired/revoked — the
 *                    server cleared the auth cookies. Definitive sign-out.
 * - anything else:   transient failure — the session may still be valid.
 *
 * Only a definitive "unauthorized" verdict is reported as "unauthenticated";
 * transient failures report "unavailable" so an open admin panel is never
 * logged out by a server hiccup — the next poll simply retries.
 */
export async function probeClientAuthState(
  refreshSession: () => Promise<RefreshSessionResult>,
): Promise<ClientAuthProbeResult> {
  const probe = async () => {
    try {
      return await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      return null;
    }
  };

  let response = await probe();

  if (!response) {
    return "unavailable";
  }

  if (response.status === 401 || response.status === 403) {
    const refreshResult = await refreshSession();

    if (refreshResult === "unauthorized") {
      // The refresh endpoint definitively rejected the session and cleared
      // the cookies — this is the only sign-out verdict.
      return "unauthenticated";
    }

    if (refreshResult !== "ok") {
      // Transient failure — the session may still be valid. Treat as
      // unavailable so an open admin panel is never logged out by a server
      // hiccup; the next poll retries.
      return "unavailable";
    }

    response = await probe();
    if (!response) {
      return "unavailable";
    }
  }

  if (response.status === 401 || response.status === 403) {
    // The refresh succeeded (session is valid) yet /api/auth/me still
    // rejects — a server-side anomaly, not a sign-out. Keep the session.
    return "unavailable";
  }

  if (!response.ok) {
    return "unavailable";
  }

  return "authenticated";
}
