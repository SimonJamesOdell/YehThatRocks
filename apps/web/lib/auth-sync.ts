"use client";

export type AuthSyncState = "authenticated" | "logged-out";
export type AuthSyncSource = "local" | "cross-tab";

type AuthSyncPayload = {
  state: AuthSyncState;
  nonce: string;
  at: number;
};

const AUTH_SYNC_STORAGE_KEY = "ytr:auth-state-sync";
const AUTH_SYNC_EVENT_NAME = "ytr:auth-state-sync";

export function publishAuthStateChange(state: AuthSyncState) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: AuthSyncPayload = {
    state,
    nonce: crypto.randomUUID(),
    at: Date.now(),
  };

  try {
    window.localStorage.setItem(AUTH_SYNC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures; the local custom event still keeps this tab in sync.
  }

  window.dispatchEvent(new CustomEvent(AUTH_SYNC_EVENT_NAME, { detail: payload }));
}

export function subscribeToAuthStateChanges(
  onAuthStateChange: (state: AuthSyncState, source: AuthSyncSource) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<AuthSyncPayload>).detail;
    if (detail?.state === "authenticated" || detail?.state === "logged-out") {
      onAuthStateChange(detail.state, "local");
    }
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== AUTH_SYNC_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      const parsed = JSON.parse(event.newValue) as Partial<AuthSyncPayload> | null;
      if (parsed?.state === "authenticated" || parsed?.state === "logged-out") {
        onAuthStateChange(parsed.state, "cross-tab");
      }
    } catch {
      // Ignore malformed payloads.
    }
  };

  window.addEventListener(AUTH_SYNC_EVENT_NAME, handleCustomEvent as EventListener);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(AUTH_SYNC_EVENT_NAME, handleCustomEvent as EventListener);
    window.removeEventListener("storage", handleStorageEvent);
  };
}