import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWithAuthRetry, refreshAuthSession } from "@/lib/client-auth-fetch";

const REFRESH_URL = "/api/auth/refresh";
const UNAUTHORIZED_BACKOFF_MS = 5 * 60_000;
const TRANSIENT_BACKOFF_MS = 30_000;

// Each test starts 10 minutes after the previous one so module-level backoff
// state never leaks between tests (the longest backoff is five minutes).
let clockBase = 2_000_000_000_000;

function jsonResponse(status: number) {
  return new Response(
    JSON.stringify(status === 200 ? { ok: true } : { error: "x" }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("refreshAuthSession", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let clockMs: number;

  beforeEach(() => {
    vi.useFakeTimers();
    clockBase += 10 * 60_000;
    clockMs = clockBase;
    vi.setSystemTime(new Date(clockMs));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns ok when the refresh endpoint accepts the session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await expect(refreshAuthSession()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(REFRESH_URL);
  });

  it("returns unauthorized on 401 and backs off for five minutes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401));

    await expect(refreshAuthSession()).resolves.toBe("unauthorized");
    await expect(refreshAuthSession()).resolves.toBe("blocked");

    vi.setSystemTime(new Date(clockMs + UNAUTHORIZED_BACKOFF_MS - 1));
    await expect(refreshAuthSession()).resolves.toBe("blocked");

    vi.setSystemTime(new Date(clockMs + UNAUTHORIZED_BACKOFF_MS));
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await expect(refreshAuthSession()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable on 503 and backs off for 30 seconds", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503));

    await expect(refreshAuthSession()).resolves.toBe("unavailable");
    await expect(refreshAuthSession()).resolves.toBe("blocked");

    vi.setSystemTime(new Date(clockMs + TRANSIENT_BACKOFF_MS));
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await expect(refreshAuthSession()).resolves.toBe("ok");
  });

  it("returns unavailable on network failure and backs off", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));

    await expect(refreshAuthSession()).resolves.toBe("unavailable");
    await expect(refreshAuthSession()).resolves.toBe("blocked");

    vi.setSystemTime(new Date(clockMs + TRANSIENT_BACKOFF_MS));
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await expect(refreshAuthSession()).resolves.toBe("ok");
  });

  it("shares one in-flight refresh across concurrent callers", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = refreshAuthSession();
    const second = refreshAuthSession();
    resolveFetch(jsonResponse(200));

    await expect(first).resolves.toBe("ok");
    await expect(second).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithAuthRetry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clockBase += 10 * 60_000;
    vi.setSystemTime(new Date(clockBase));
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("passes through successful responses untouched", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    const response = await fetchWithAuthRetry("/api/whatever");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes through non-401/403 failures without refreshing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500));

    const response = await fetchWithAuthRetry("/api/whatever");

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes once and retries when a request 401s", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200))
      .mockResolvedValueOnce(jsonResponse(200));

    const response = await fetchWithAuthRetry("/api/whatever");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain(REFRESH_URL);
  });

  it("returns the original 401 when the refresh is rejected", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(401));

    const response = await fetchWithAuthRetry("/api/whatever");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the original 401 when the refresh endpoint is unreachable", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockRejectedValueOnce(new TypeError("network down"));

    const response = await fetchWithAuthRetry("/api/whatever");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never refreshes for the refresh endpoint itself", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401));

    const response = await fetchWithAuthRetry(REFRESH_URL, { method: "POST" });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
