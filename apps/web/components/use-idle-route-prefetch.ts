"use client";

import { useEffect } from "react";

type RouterLike = {
  prefetch: (href: string) => void;
};

export function useIdleRoutePrefetch(targetHrefs: string[], router: RouterLike) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (targetHrefs.length === 0) {
      return;
    }

    let cancelled = false;
    let idleId: number | null = null;

    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;

    const cancelIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).cancelIdleCallback;

    const warmRoutes = () => {
      if (cancelled) {
        return;
      }
      for (const href of targetHrefs) {
        router.prefetch(href);
      }
    };

    const timeoutId = window.setTimeout(() => {
      if (typeof requestIdle === "function") {
        idleId = requestIdle(() => {
          warmRoutes();
        }, { timeout: 1500 });
        return;
      }
      warmRoutes();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (idleId !== null && typeof cancelIdle === "function") {
        cancelIdle(idleId);
      }
    };
  }, [router, targetHrefs]);
}
