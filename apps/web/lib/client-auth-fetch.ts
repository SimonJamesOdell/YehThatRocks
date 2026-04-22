let refreshInFlight: Promise<boolean> | null = null;

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

async function refreshAuthSession() {
  if (refreshInFlight) {
    return refreshInFlight;
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

      return response.ok;
    } catch {
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
