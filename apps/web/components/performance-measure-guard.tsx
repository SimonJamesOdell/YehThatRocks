"use client";

import { useLayoutEffect } from "react";

/**
 * Patches performance.measure to suppress negative-timestamp errors that
 * occur during React hydration. Runs via useLayoutEffect so the patch is
 * in place before any other client code fires.
 */
export function PerformanceMeasureGuard() {
  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof performance === "undefined") return;

    const perf = performance as unknown as Record<string, unknown> & {
      measure: (...args: Parameters<Performance["measure"]>) => PerformanceMeasure | undefined;
      __ytrMeasurePatched?: boolean;
    };

    if (perf.__ytrMeasurePatched) return;

    const originalMeasure = perf.measure.bind(perf);
    perf.__ytrMeasurePatched = true;

    perf.measure = function (...args: Parameters<Performance["measure"]>) {
      try {
        return originalMeasure.apply(perf, args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("negative time stamp") ||
          message.includes("cannot have a negative time stamp") ||
          message.includes("Failed to execute 'measure'") ||
          message.includes("NotFound")
        ) {
          return;
        }
        throw error;
      }
    };
  }, []);

  return null;
}
