export function readPersistedBoolean(key: string, fallback = false) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "true") {
      return true;
    }

    if (raw === "false") {
      return false;
    }
  } catch {
    // Ignore localStorage access failures (private mode, quota, etc).
  }

  return fallback;
}

export function writePersistedBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore localStorage access failures.
  }
}
