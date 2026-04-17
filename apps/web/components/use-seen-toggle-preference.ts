"use client";

import { useEffect, useState } from "react";

import { readPersistedBoolean, writePersistedBoolean } from "@/lib/persisted-boolean";

type UseSeenTogglePreferenceInput = {
  key: string;
  isAuthenticated: boolean;
  defaultValue?: boolean;
};

export function useSeenTogglePreference({
  key,
  isAuthenticated,
  defaultValue = false,
}: UseSeenTogglePreferenceInput) {
  const [value, setValue] = useState(() => (isAuthenticated ? readPersistedBoolean(key, defaultValue) : false));
  const [isServerHydrated, setIsServerHydrated] = useState(() => !isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    writePersistedBoolean(key, value);
  }, [isAuthenticated, key, value]);

  useEffect(() => {
    if (!isAuthenticated) {
      setValue(false);
      setIsServerHydrated(true);
      return;
    }

    let cancelled = false;
    setIsServerHydrated(false);

    const loadServerValue = async () => {
      try {
        const response = await fetch(`/api/seen-toggle-preferences?key=${encodeURIComponent(key)}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as { value?: boolean | null } | null;

        if (cancelled || typeof payload?.value !== "boolean") {
          return;
        }

        setValue(payload.value);
      } catch {
        // Keep local fallback value when preference fetch fails.
      } finally {
        if (!cancelled) {
          setIsServerHydrated(true);
        }
      }
    };

    void loadServerValue();

    return () => {
      cancelled = true;
    };
  }, [defaultValue, isAuthenticated, key]);

  useEffect(() => {
    if (!isAuthenticated || !isServerHydrated) {
      return;
    }

    void fetch("/api/seen-toggle-preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
      }),
    }).catch(() => {
      // Keep UI responsive even if background persistence fails.
    });
  }, [isAuthenticated, isServerHydrated, key, value]);

  return [value, setValue] as const;
}
