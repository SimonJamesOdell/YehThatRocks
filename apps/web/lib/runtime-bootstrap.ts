type RuntimePatchState = {
  safePerformanceMeasureApplied?: boolean;
  webShareWarnFilterApplied?: boolean;
};

type RuntimeGlobal = typeof globalThis & {
  __ytrRuntimePatchState__?: RuntimePatchState;
};

export type RuntimeBootstrapPatchOptions = {
  safePerformanceMeasure?: boolean;
  suppressWebShareWarning?: boolean;
};

const NON_FATAL_PERFORMANCE_MEASURE_ERRORS = [
  "negative time stamp",
  "cannot have a negative time stamp",
  "Failed to execute 'measure'",
  "NotFound",
] as const;

function getRuntimePatchState() {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  if (!runtimeGlobal.__ytrRuntimePatchState__) {
    runtimeGlobal.__ytrRuntimePatchState__ = {};
  }

  return runtimeGlobal.__ytrRuntimePatchState__;
}

function isIgnorablePerformanceMeasureError(message: string) {
  return NON_FATAL_PERFORMANCE_MEASURE_ERRORS.some((pattern) => message.includes(pattern));
}

export function enableSafePerformanceMeasurePatch() {
  if (typeof window === "undefined" || typeof performance === "undefined") {
    return;
  }

  const state = getRuntimePatchState();
  if (state.safePerformanceMeasureApplied) {
    return;
  }

  const originalMeasure = performance.measure.bind(performance);
  state.safePerformanceMeasureApplied = true;

  const patchedMeasure = (
    ...args: Parameters<Performance["measure"]>
  ): ReturnType<Performance["measure"]> | undefined => {
    try {
      return originalMeasure(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isIgnorablePerformanceMeasureError(message)) {
        return undefined;
      }

      throw error;
    }
  };

  performance.measure = patchedMeasure as Performance["measure"];
}

export function enableWebShareConsoleWarnFilter() {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    return;
  }

  const state = getRuntimePatchState();
  if (state.webShareWarnFilterApplied) {
    return;
  }

  const originalWarn = console.warn.bind(console);
  state.webShareWarnFilterApplied = true;

  console.warn = (...args: unknown[]) => {
    const first = args[0];
    const message = typeof first === "string" ? first : "";

    // YouTube widget emits this repeatedly in some browsers; hide this known non-actionable warning.
    if (message.includes("Unrecognized feature: 'web-share'.")) {
      return;
    }

    originalWarn(...args);
  };
}

export function applyRuntimeBootstrapPatches(options: RuntimeBootstrapPatchOptions) {
  if (options.safePerformanceMeasure) {
    enableSafePerformanceMeasurePatch();
  }

  if (options.suppressWebShareWarning) {
    enableWebShareConsoleWarnFilter();
  }
}
