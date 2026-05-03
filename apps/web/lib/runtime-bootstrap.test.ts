import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyRuntimeBootstrapPatches,
  enableSafePerformanceMeasurePatch,
  enableWebShareConsoleWarnFilter,
} from "@/lib/runtime-bootstrap";

type RuntimeGlobal = typeof globalThis & {
  __ytrRuntimePatchState__?: unknown;
};

const originalMeasure = globalThis.performance.measure;
const originalWarn = console.warn;

afterEach(() => {
  globalThis.performance.measure = originalMeasure;
  console.warn = originalWarn;
  delete (globalThis as RuntimeGlobal).__ytrRuntimePatchState__;
  vi.unstubAllEnvs();
});

describe("runtime bootstrap patches", () => {
  it("swallows known non-fatal performance.measure errors", () => {
    globalThis.performance.measure = vi.fn(() => {
      throw new Error("Failed to execute 'measure'");
    }) as Performance["measure"];

    enableSafePerformanceMeasurePatch();

    expect(() => globalThis.performance.measure("boot")).not.toThrow();
  });

  it("rethrows unexpected performance.measure errors", () => {
    globalThis.performance.measure = vi.fn(() => {
      throw new Error("unexpected-failure");
    }) as Performance["measure"];

    enableSafePerformanceMeasurePatch();

    expect(() => globalThis.performance.measure("boot")).toThrow("unexpected-failure");
  });

  it("applies performance patch only once", () => {
    globalThis.performance.measure = vi.fn(() => undefined) as Performance["measure"];

    enableSafePerformanceMeasurePatch();
    const patched = globalThis.performance.measure;
    enableSafePerformanceMeasurePatch();

    expect(globalThis.performance.measure).toBe(patched);
  });

  it("suppresses web-share console warning in development only", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warnSpy = vi.fn();
    console.warn = warnSpy;

    enableWebShareConsoleWarnFilter();

    console.warn("Unrecognized feature: 'web-share'.");
    console.warn("different warning");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenLastCalledWith("different warning");
  });

  it("does not patch console.warn outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.fn();
    console.warn = warnSpy;

    enableWebShareConsoleWarnFilter();
    console.warn("Unrecognized feature: 'web-share'.");

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("supports explicit opt-in patch selection", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warnSpy = vi.fn();
    console.warn = warnSpy;
    globalThis.performance.measure = vi.fn(() => {
      throw new Error("Failed to execute 'measure'");
    }) as Performance["measure"];

    applyRuntimeBootstrapPatches({
      safePerformanceMeasure: true,
      suppressWebShareWarning: true,
    });

    expect(() => globalThis.performance.measure("boot")).not.toThrow();
    console.warn("Unrecognized feature: 'web-share'.");
    expect(warnSpy).toHaveBeenCalledTimes(0);
  });
});
