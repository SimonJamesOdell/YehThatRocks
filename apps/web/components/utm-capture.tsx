"use client";

import { useEffect } from "react";

import { UTM_STORAGE_KEY, parseUtmParams, hasUtmParams } from "@/lib/utm";

/**
 * First-touch attribution capture. On mount, reads UTM params from the current
 * URL and persists them to localStorage under a stable key so they survive
 * navigation (e.g. landing on `/` then going to `/register`).
 *
 * Rendered in the root layout as a no-UI client component.
 */
export function UtmCapture() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const params = parseUtmParams(window.location.search);
      if (!hasUtmParams(params)) {
        return;
      }

      const existingRaw = window.localStorage.getItem(UTM_STORAGE_KEY);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const merged = { ...existing, ...params, capturedAt: Date.now() };
      window.localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // localStorage may be unavailable (private browsing). Attribution is
      // best-effort and must never break the page.
    }
  }, []);

  return null;
}
