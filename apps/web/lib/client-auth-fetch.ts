let refreshInFlight: Promise<boolean> | null = null;

// Backoff guard: after a failed refresh attempt we stop retrying for a while.
// Without this, a stale admin tab with an expired session hammers
// /api/auth/refresh on every poll (observed: 775 failed refreshes/day from a
// single device), inflating auth traffic metrics.
let refreshRetryNotBeforeAt = 0;

const REFRESH_NETWORK_FAILURE_BACKOFF_MS = 30_000;
const REFRESH_UNAUTHORIZED_BACKOFF_MS = 5 * 60_000;

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

export async function refreshAuthSession() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  if (Date.now() < refreshRetryNotBeforeAt) {
    return false;
  }

  const refreshPromise = (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      if (response.ok) {
        refreshRetryNotBeforeAt = 0;
        return true;
      }

      // 401 = invalid/expired refresh token (server clears cookies): back off
      // longer. Other failures (e.g. 503) are transient: short backoff.
      const backoffMs = response.status === 401
        ? REFRESH_UNAUTHORIZED_BACKOFF_MS
        : REFRESH_NETWORK_FAILURE_BACKOFF_MS;
      refreshRetryNotBeforeAt = Date.now() + backoffMs;
      return false;
    } catch {
      refreshRetryNotBeforeAt = Date.now() + REFRESH_NETWORK_FAILURE_BACKOFF_MS;
      return false;
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

  const didRefresh = await refreshAuthSession();

  if (!didRefresh) {
    return response;
  }

  response = await fetch(input, requestInit);
  return response;
}
