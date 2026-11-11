export type RefreshSessionResult = "ok" | "unauthorized" | "unavailable" | "blocked";

let refreshInFlight: Promise<RefreshSessionResult> | null = null;

// Backoff guard: after a failed refresh attempt we stop retrying for a while.
// Without this, a stale admin tab with an expired session hammers
// /api/auth/refresh on every poll (observed: 775 failed refreshes/day from a
// single device), inflating auth traffic metrics.
let refreshRetryNotBeforeAt = 0;

const REFRESH_NETWORK_FAILURE_BACKOFF_MS = 30_000;
const REFRESH_UNAUTHORIZED_BACKOFF_MS = 5 * 60_000;

/**
 * The origin only ever answers auth endpoints with `application/json`. A
 * response without that content type is an interstitial — Cloudflare bot-fight
 * / Under Attack Mode challenges, a proxy error page, or a captive portal —
 * and must never be mistaken for a genuine auth verdict. This is the central
 * guard against bot-fight mode "interfering with the auth signals": the client
 * used to treat any 200 as `ok` and any 401 as a definitive sign-out, which is
 * exactly what a Cloudflare challenge page can spoof.
 */
export function isOriginJsonResponse(response: Response): boolean {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  return contentType.includes("application/json");
}

export type RefreshResponseClass = "ok" | "unauthorized" | "unavailable";

/**
 * Classify a /api/auth/refresh response into a precise verdict:
 *
 * - "ok":           genuine JSON success from the origin (body `{ ok: true }`).
 * - "unauthorized": genuine JSON 401 from the origin — the refresh token is
 *                   invalid/expired/revoked and the server cleared cookies.
 * - "unavailable":  everything else (network error, 503/500, and critically
 *                   any HTML challenge page regardless of its status code).
 */
export async function classifyRefreshResponse(response: Response): Promise<RefreshResponseClass> {
  if (response.status === 401 && isOriginJsonResponse(response)) {
    return "unauthorized";
  }

  if (response.ok && isOriginJsonResponse(response)) {
    try {
      const payload = (await response.json()) as { ok?: unknown };
      if (payload && payload.ok === true) {
        return "ok";
      }
    } catch {
      // Malformed/non-JSON body — fall through to transient.
    }
  }

  return "unavailable";
}

function isRefreshEndpoint(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input.includes("/api/auth/refresh");
  }

  if (input instanceof URL) {
    return input.pathname === "/api/auth/refresh";
  }

  if (input instanceof Request) {
    return input.url.includes("/api/auth/refresh");
  }

  return false;
}

/**
 * Attempt a session refresh and report the outcome precisely so callers can
 * tell a dead session apart from a temporarily unreachable auth server:
 *
 * - "ok":            new tokens issued (or the request raced another tab).
 * - "unauthorized":  the refresh token is invalid/expired/revoked — the
 *                    server cleared the auth cookies. Definitive sign-out.
 * - "unavailable":   network error, non-401 failure (503/500), or an HTML
 *                    challenge interstitial — the session may still be valid.
 * - "blocked":       a recent failure is still in its backoff window.
 */
export async function refreshAuthSession(): Promise<RefreshSessionResult> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  if (Date.now() < refreshRetryNotBeforeAt) {
    return "blocked";
  }

  const refreshPromise = (async (): Promise<RefreshSessionResult> => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      const verdict = await classifyRefreshResponse(response);

      if (verdict === "ok") {
        refreshRetryNotBeforeAt = 0;
        return "ok";
      }

      // 401 = invalid/expired refresh token (server clears cookies): back off
      // longer. Other failures (503/500/challenge page) are transient: short
      // backoff.
      const backoffMs = verdict === "unauthorized"
        ? REFRESH_UNAUTHORIZED_BACKOFF_MS
        : REFRESH_NETWORK_FAILURE_BACKOFF_MS;
      refreshRetryNotBeforeAt = Date.now() + backoffMs;
      return verdict;
    } catch {
      refreshRetryNotBeforeAt = Date.now() + REFRESH_NETWORK_FAILURE_BACKOFF_MS;
      return "unavailable";
    }
  })();

  refreshInFlight = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    refreshInFlight = null;
  }
}

export async function fetchWithAuthRetry(input: RequestInfo | URL, init?: RequestInit) {
  const requestInit: RequestInit = {
    credentials: "same-origin",
    ...init,
  };

  let response = await fetch(input, requestInit);

  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  if (isRefreshEndpoint(input)) {
    return response;
  }

  const didRefresh = (await refreshAuthSession()) === "ok";

  if (!didRefresh) {
    return response;
  }

  response = await fetch(input, requestInit);
  return response;
}
