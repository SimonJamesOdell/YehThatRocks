/**
 * Admin Dashboard Utilities
 * Shared helpers across all admin domains
 */

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";
import { finiteNumberOrNull } from "@/lib/number-utils";
import { parseJsonOrNull } from "@/lib/parse-json";

// Numeric helpers
export function finiteOrNull(value: number | null | undefined): number | null {
  return finiteNumberOrNull(value);
}

// Error handling
export function isAuthResponseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Unauthorized" ||
    error.message === "Forbidden" ||
    error.message.includes("(401)") ||
    error.message.includes("(403)")
  );
}

// JSON fetch helpers
export async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuthRetry(input, init);

  if (!response.ok) {
    const payload = (await parseJsonOrNull(response)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export async function readNoStoreJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  return readJson<T>(input, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      "Cache-Control": "no-store",
    },
  });
}

export async function patchJson(url: string, body: Record<string, unknown>): Promise<void> {
  await readJson(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  return readJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
