export type FrontendLoaderJsonResult<T> =
  | {
      ok: true;
      data: T;
      attempts: number;
    }
  | {
      ok: false;
      attempts: number;
      timedOut: boolean;
      status: number | null;
      reason: "http" | "network" | "timeout" | "parse";
      message: string;
    };

type FrontendLoaderRequestOptions = {
  input: RequestInfo | URL;
  init?: RequestInit;
  timeoutMs?: number;
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  failureMessage: string;
  fetcher?: typeof fetch;
};

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function fetchJsonWithLoaderContract<T>(
  options: FrontendLoaderRequestOptions,
): Promise<FrontendLoaderJsonResult<T>> {
  const {
    input,
    init,
    timeoutMs,
    failureMessage,
    fetcher = fetch,
    maxAttempts = 3,
    initialDelayMs = 700,
    backoffMultiplier = 2,
  } = options;

  const attemptsLimit = Math.max(1, maxAttempts);
  let attempts = 0;
  let delayMs = Math.max(0, initialDelayMs);

  while (attempts < attemptsLimit) {
    attempts += 1;

    const abortController = new AbortController();
    const timeoutId = timeoutMs
      ? window.setTimeout(() => {
          abortController.abort();
        }, timeoutMs)
      : null;

    try {
      const response = await fetcher(input, {
        ...init,
        signal: abortController.signal,
      });

      if (!response.ok) {
        if (attempts < attemptsLimit && isRetryableStatus(response.status)) {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
          await sleep(delayMs);
          delayMs = Math.max(delayMs, Math.round(delayMs * backoffMultiplier));
          continue;
        }

        return {
          ok: false,
          attempts,
          timedOut: false,
          status: response.status,
          reason: "http",
          message: failureMessage,
        };
      }

      const data = (await response.json().catch(() => null)) as T | null;
      if (data === null) {
        return {
          ok: false,
          attempts,
          timedOut: false,
          status: response.status,
          reason: "parse",
          message: failureMessage,
        };
      }

      return {
        ok: true,
        data,
        attempts,
      };
    } catch (error) {
      const timedOut = isAbortError(error) && Boolean(timeoutMs);
      if (attempts < attemptsLimit) {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        await sleep(delayMs);
        delayMs = Math.max(delayMs, Math.round(delayMs * backoffMultiplier));
        continue;
      }

      return {
        ok: false,
        attempts,
        timedOut,
        status: null,
        reason: timedOut ? "timeout" : "network",
        message: failureMessage,
      };
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  return {
    ok: false,
    attempts,
    timedOut: false,
    status: null,
    reason: "network",
    message: failureMessage,
  };
}