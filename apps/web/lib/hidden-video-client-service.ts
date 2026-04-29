import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

export type HiddenVideoMutationAction = "hide" | "unhide";

type HiddenVideoMutationErrorCode = "unauthorized" | "forbidden" | "server" | "network" | "unknown";

type HiddenVideoMutationMessages = {
  unauthorized: string;
  success: string;
  failure: string;
  rollbackFailure?: string;
};

type HiddenVideoMutationContext<TPayload> = {
  action: HiddenVideoMutationAction;
  videoId: string;
  payload: TPayload | null;
  status: number;
};

type HiddenVideoMutationOptions<TPayload> = {
  action: HiddenVideoMutationAction;
  videoId: string;
  activePlaylistId?: string | null;
  rollbackOnError?: boolean;
  messages?: Partial<HiddenVideoMutationMessages>;
  onOptimisticUpdate?: () => void;
  onRollback?: () => void;
  onUnauthorized?: () => void;
  onSuccess?: (context: HiddenVideoMutationContext<TPayload>) => void;
  onSettled?: () => void;
};

export type HiddenVideoMutationResult<TPayload> =
  | {
      ok: true;
      status: number;
      payload: TPayload | null;
      message: string;
    }
  | {
      ok: false;
      status: number | null;
      code: HiddenVideoMutationErrorCode;
      message: string;
      didRollback: boolean;
    };

const DEFAULT_MESSAGES: Record<HiddenVideoMutationAction, HiddenVideoMutationMessages> = {
  hide: {
    unauthorized: "Sign in to hide tracks.",
    success: "Track hidden.",
    failure: "Track removed, but hidden preference could not be saved.",
    rollbackFailure: "Could not hide that track. Please try again.",
  },
  unhide: {
    unauthorized: "Sign in to manage blocked videos.",
    success: "Track unblocked.",
    failure: "Could not unblock that track. Please try again.",
    rollbackFailure: "Could not unblock that track. Please try again.",
  },
};

function mapErrorCode(status: number | null): HiddenVideoMutationErrorCode {
  if (status === 401) {
    return "unauthorized";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status !== null && status >= 500) {
    return "server";
  }

  return "unknown";
}

function resolveRequestUrl(action: HiddenVideoMutationAction, activePlaylistId?: string | null) {
  if (action === "hide" && activePlaylistId && activePlaylistId.trim().length > 0) {
    return `/api/hidden-videos?activePlaylistId=${encodeURIComponent(activePlaylistId)}`;
  }

  return "/api/hidden-videos";
}

function resolveMethod(action: HiddenVideoMutationAction) {
  return action === "hide" ? "POST" : "DELETE";
}

export async function mutateHiddenVideo<TPayload = Record<string, unknown>>(
  options: HiddenVideoMutationOptions<TPayload>,
): Promise<HiddenVideoMutationResult<TPayload>> {
  const {
    action,
    videoId,
    activePlaylistId,
    rollbackOnError = false,
    onOptimisticUpdate,
    onRollback,
    onUnauthorized,
    onSuccess,
    onSettled,
  } = options;

  const messages = {
    ...DEFAULT_MESSAGES[action],
    ...(options.messages ?? {}),
  };

  onOptimisticUpdate?.();

  let didRollback = false;
  const rollbackIfNeeded = () => {
    if (!rollbackOnError || didRollback) {
      return;
    }

    didRollback = true;
    onRollback?.();
  };

  try {
    const response = await fetchWithAuthRetry(resolveRequestUrl(action, activePlaylistId), {
      method: resolveMethod(action),
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoId }),
    });

    const payload = (await response.json().catch(() => null)) as TPayload | null;

    if (response.status === 401 || response.status === 403) {
      rollbackIfNeeded();
      onUnauthorized?.();
      return {
        ok: false,
        status: response.status,
        code: mapErrorCode(response.status),
        message: messages.unauthorized,
        didRollback,
      };
    }

    if (!response.ok) {
      rollbackIfNeeded();
      return {
        ok: false,
        status: response.status,
        code: mapErrorCode(response.status),
        message: didRollback
          ? messages.rollbackFailure ?? messages.failure
          : messages.failure,
        didRollback,
      };
    }

    onSuccess?.({
      action,
      videoId,
      payload,
      status: response.status,
    });

    return {
      ok: true,
      status: response.status,
      payload,
      message: messages.success,
    };
  } catch {
    rollbackIfNeeded();
    return {
      ok: false,
      status: null,
      code: "network",
      message: didRollback
        ? messages.rollbackFailure ?? messages.failure
        : messages.failure,
      didRollback,
    };
  } finally {
    onSettled?.();
  }
}