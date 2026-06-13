import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
    $executeRaw: executeRawMock,
  },
}));

// Override readPositiveNumberEnv to bypass min-value clamping in tests.
vi.mock("@/lib/number-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/number-utils")>();
  return {
    ...actual,
    readPositiveNumberEnv: (name: string, fallback: number, _min: number) => {
      // Use env override if set; otherwise fall back to the original function.
      const envOverride = process.env[name];
      if (envOverride !== undefined) {
        const parsed = Number(envOverride);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return (actual as typeof import("@/lib/number-utils")).readPositiveNumberEnv(name, fallback, _min);
    },
  };
});

/** Small helper to wait for real time to pass. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("admin-dashboard-health idle timeout", () => {
  beforeEach(async () => {
    vi.resetModules();
    queryRawMock.mockReset();
    executeRawMock.mockReset();

    process.env.DATABASE_URL = "mysql://test";
    // Very short intervals — our mock bypasses min-value clamping.
    process.env.ADMIN_IDLE_TIMEOUT_MS = "200";
    process.env.ADMIN_HOST_METRIC_SAMPLE_INTERVAL_MS = "50";
    process.env.ADMIN_CPU_LIVE_SAMPLE_MS = "25";
    // Prevent the health cache from masking activity-touch effects.
    process.env.ADMIN_HEALTH_CACHE_MS = "0";

    executeRawMock.mockResolvedValue(undefined);
    queryRawMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts admin host metric sampling when DATABASE_URL is set", async () => {
    const { startAdminHostMetricSampling } = await import("@/lib/admin-dashboard-health");

    expect(() => startAdminHostMetricSampling()).not.toThrow();
    expect(() => startAdminHostMetricSampling()).not.toThrow();
  });

  it("does not start admin host metric sampling when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    const { startAdminHostMetricSampling } = await import("@/lib/admin-dashboard-health");

    startAdminHostMetricSampling();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it("sampling restarts after idle timeout elapses", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const { startAdminHostMetricSampling } = await import("@/lib/admin-dashboard-health");

    startAdminHostMetricSampling();
    const setIntervalCountAfterStart = setIntervalSpy.mock.calls.length;
    expect(setIntervalCountAfterStart).toBeGreaterThan(0);

    // Calling again while active is a no-op.
    startAdminHostMetricSampling();
    expect(setIntervalSpy.mock.calls.length).toBe(setIntervalCountAfterStart);

    // Wait for idle timeout (200ms) + interval tick (50ms) + generous buffer.
    await delay(400);

    // Now the interval should have self-cleared. Calling start again
    // should create a NEW setInterval (proving the flag was reset).
    startAdminHostMetricSampling();
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(setIntervalCountAfterStart);

    setIntervalSpy.mockRestore();
  });

  it("sampling stays alive when activity is touched via getAdminCpuDialSnapshot", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const { getAdminCpuDialSnapshot, startAdminHostMetricSampling } =
      await import("@/lib/admin-dashboard-health");

    startAdminHostMetricSampling();
    const setIntervalCountAfterStart = setIntervalSpy.mock.calls.length;

    // Touch activity at 100ms — resetting the idle timer.
    await delay(100);
    getAdminCpuDialSnapshot();

    // Wait 150ms more — total 250ms since start, but only 150ms since touch.
    // That's less than the 200ms idle timeout.
    await delay(150);

    // Should still be a no-op (sampling still active).
    startAdminHostMetricSampling();
    expect(setIntervalSpy.mock.calls.length).toBe(setIntervalCountAfterStart);

    // Now wait long enough past the touch for idle timeout to fire.
    await delay(250);

    // After idle timeout, a restart creates a new interval.
    startAdminHostMetricSampling();
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(setIntervalCountAfterStart);

    setIntervalSpy.mockRestore();
  });

  it("sampling stays alive when activity is touched via buildAdminHealthPayload", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const { startAdminHostMetricSampling } = await import("@/lib/admin-dashboard-health");
    startAdminHostMetricSampling();
    const setIntervalCountAfterStart = setIntervalSpy.mock.calls.length;

    // Touch activity at 100ms.
    await delay(100);
    const { buildAdminHealthPayload } = await import("@/lib/admin-dashboard-health");
    void buildAdminHealthPayload();

    // Wait 150ms more — still within idle window since we touched at 100ms.
    await delay(150);
    startAdminHostMetricSampling();
    expect(setIntervalSpy.mock.calls.length).toBe(setIntervalCountAfterStart);

    // Wait past idle timeout.
    await delay(250);
    startAdminHostMetricSampling();
    expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(setIntervalCountAfterStart);

    setIntervalSpy.mockRestore();
  });
});
