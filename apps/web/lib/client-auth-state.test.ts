import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeClientAuthState } from "@/lib/client-auth-state";
import type { RefreshSessionResult } from "@/lib/client-auth-fetch";

function jsonResponse(status: number, body: unknown = { user: { id: 1, email: "a@b.c" } }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(status: number) {
  return new Response("<html><body>Checking your browser before accessing…</body></html>", {
    status,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

describe("probeClientAuthState", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let refreshMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    refreshMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports authenticated for a JSON 200 from /api/auth/me", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await expect(probeClientAuthState(refreshMock)).resolves.toBe("authenticated");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reports unavailable for a 200 HTML challenge page (never authenticated)", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(200));

    await expect(probeClientAuthState(refreshMock)).resolves.toBe("unavailable");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("reports unavailable for a 403 HTML challenge page without refreshing", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(403));

    await expect(probeClientAuthState(refreshMock)).resolves.toBe("unavailable");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes once and reports authenticated when a JSON 401 is followed by a successful refresh", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "Unauthorized" }))
      .mockResolvedValueOnce(jsonResponse(200));
    refreshMock.mockResolvedValueOnce("ok" as RefreshSessionResult);

    await expect(probeClientAuthState(refreshMock)).resolves.toBe("authenticated");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports unauthenticated when a JSON 401 is followed by a definitive unauthorized refresh", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Unauthorized" }));
    refreshMock.mockResolvedValueOnce("unauthorized" as RefreshSessionResult);

    await expect(probeClientAuthState(refreshMock)).resolves.toBe("unauthenticated");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable when a JSON 401 is followed by a transient refresh failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Unauthorized" }));
    refreshMock.mockResolvedValueOnce("unavailable" as RefreshSessionResult);

    await expect(probeClientAuthState(refreshMock)).resolves.toBe("unavailable");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable for a JSON 503 from the origin", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { error: "Auth verification unavailable", code: "AUTH_UNAVAILABLE" }),
    );

    await expect(probeClientAuthState(refreshMock)).resolves.toBe("unavailable");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
