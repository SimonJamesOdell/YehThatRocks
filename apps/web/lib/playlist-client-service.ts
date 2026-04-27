import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

export const PLAYLIST_CLIENT_TELEMETRY_EVENT = "ytr:playlist-client-telemetry";

type PlaylistOperation = "list" | "create" | "add-item" | "add-items";

type PlaylistServiceErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "bad-request"
  | "server"
  | "network"
  | "unknown";

export type PlaylistServiceError = {
  code: PlaylistServiceErrorCode;
  status: number | null;
  message: string;
};

export type PlaylistServiceResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; error: PlaylistServiceError };

export type PlaylistSummaryClient = {
  id: string;
  name: string;
  itemCount?: number;
  leadVideoId?: string;
};

export type PlaylistVideoClient = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail?: string | null;
};

export type PlaylistMutationPayload = {
  id?: string;
  name?: string;
  itemCount?: number;
  videos?: PlaylistVideoClient[];
};

type PlaylistServiceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ServiceOptions = {
  fetcher?: PlaylistServiceFetch;
  telemetryContext?: Record<string, unknown>;
};

function mapErrorCode(status: number | null): PlaylistServiceErrorCode {
  if (status === 401) {
    return "unauthorized";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status === 404) {
    return "not-found";
  }

  if (status === 400) {
    return "bad-request";
  }

  if (status !== null && status >= 500) {
    return "server";
  }

  return "unknown";
}

function defaultMessage(operation: PlaylistOperation, code: PlaylistServiceErrorCode) {
  if (code === "unauthorized" || code === "forbidden") {
    return operation === "add-item" || operation === "add-items"
      ? "Sign in to save tracks to playlists."
      : "Sign in to create playlists.";
  }

  if (operation === "create") {
    return "Could not create playlist.";
  }

  if (operation === "add-item") {
    return "Could not add track to playlist.";
  }

  if (operation === "add-items") {
    return "Could not save tracks to playlist.";
  }

  return "Could not load playlists.";
}

function emitTelemetry(
  operation: PlaylistOperation,
  ok: boolean,
  durationMs: number,
  status: number | null,
  code: PlaylistServiceErrorCode | null,
  context?: Record<string, unknown>,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(PLAYLIST_CLIENT_TELEMETRY_EVENT, {
    detail: {
      operation,
      ok,
      durationMs,
      status,
      code,
      ...(context ?? {}),
    },
  }));
}

async function requestJson<T>(
  operation: PlaylistOperation,
  input: RequestInfo | URL,
  init: RequestInit,
  options?: ServiceOptions,
): Promise<PlaylistServiceResult<T>> {
  const startedAt = Date.now();
  const fetcher = options?.fetcher ?? fetchWithAuthRetry;

  try {
    const response = await fetcher(input, init);
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const code = mapErrorCode(response.status);
      emitTelemetry(operation, false, durationMs, response.status, code, options?.telemetryContext);
      return {
        ok: false,
        error: {
          code,
          status: response.status,
          message: defaultMessage(operation, code),
        },
      };
    }

    const data = (await response.json().catch(() => null)) as T;
    emitTelemetry(operation, true, durationMs, response.status, null, options?.telemetryContext);

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch {
    const durationMs = Date.now() - startedAt;
    emitTelemetry(operation, false, durationMs, null, "network", options?.telemetryContext);

    return {
      ok: false,
      error: {
        code: "network",
        status: null,
        message: defaultMessage(operation, "network"),
      },
    };
  }
}

export async function listPlaylistsClient(options?: ServiceOptions) {
  const result = await requestJson<{ playlists?: PlaylistSummaryClient[] }>(
    "list",
    "/api/playlists",
    { method: "GET", cache: "no-store" },
    options,
  );

  if (!result.ok) {
    return result;
  }

  return {
    ok: true as const,
    status: result.status,
    data: Array.isArray(result.data?.playlists) ? result.data.playlists : [],
  };
}

export async function createPlaylistClient(
  input: { name: string; videoIds?: string[] },
  options?: ServiceOptions,
) {
  const payload = {
    name: input.name,
    videoIds: Array.isArray(input.videoIds) ? input.videoIds : [],
  };

  return requestJson<PlaylistMutationPayload>(
    "create",
    "/api/playlists",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export async function addPlaylistItemClient(
  input: { playlistId: string; videoId: string },
  options?: ServiceOptions,
) {
  return requestJson<PlaylistMutationPayload>(
    "add-item",
    `/api/playlists/${encodeURIComponent(input.playlistId)}/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: input.videoId }),
    },
    options,
  );
}

export async function addPlaylistItemsClient(
  input: { playlistId: string; videoIds: string[] },
  options?: ServiceOptions,
) {
  return requestJson<PlaylistMutationPayload>(
    "add-items",
    `/api/playlists/${encodeURIComponent(input.playlistId)}/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoIds: input.videoIds }),
    },
    options,
  );
}
