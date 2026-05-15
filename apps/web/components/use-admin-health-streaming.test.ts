import { describe, expect, it } from "vitest";

import { mergeCpuDialIntoHealthPayload } from "@/components/use-admin-health-streaming";

describe("mergeCpuDialIntoHealthPayload", () => {
  it("updates only CPU fields and preserves the rest of host health", () => {
    const basePayload = {
      meta: { generatedAt: "2026-05-15T00:00:00.000Z" },
      health: {
        nodeUptimeSec: 120,
        memory: { rssMb: 100, heapUsedMb: 50, heapTotalMb: 80 },
        host: {
          platform: "linux",
          loadAvg: [0.1, 0.2, 0.3],
          totalMemMb: 1024,
          freeMemMb: 512,
          cpuUsagePercent: 10,
          cpuAverageUsagePercent: 15,
          cpuPeakCoreUsagePercent: 20,
          memoryUsagePercent: 50,
          diskUsagePercent: 40,
          swapUsagePercent: 5,
          networkUsagePercent: 2,
        },
      },
    };

    const merged = mergeCpuDialIntoHealthPayload(basePayload, {
      generatedAt: "2026-05-15T00:00:01.000Z",
      cpuUsagePercent: 33.3,
      cpuAverageUsagePercent: 28.8,
      cpuPeakCoreUsagePercent: 61.2,
    });

    expect(merged.meta?.generatedAt).toBe("2026-05-15T00:00:01.000Z");
    expect(merged.health?.host.cpuUsagePercent).toBe(33.3);
    expect(merged.health?.host.cpuAverageUsagePercent).toBe(28.8);
    expect(merged.health?.host.cpuPeakCoreUsagePercent).toBe(61.2);
    expect(merged.health?.host.memoryUsagePercent).toBe(50);
    expect(merged.health?.host.diskUsagePercent).toBe(40);
    expect(merged.health?.nodeUptimeSec).toBe(120);
  });

  it("sanitizes non-finite CPU values to null", () => {
    const basePayload = {
      meta: { generatedAt: "2026-05-15T00:00:00.000Z" },
      health: {
        nodeUptimeSec: 120,
        memory: { rssMb: 100, heapUsedMb: 50, heapTotalMb: 80 },
        host: {
          platform: "linux",
          loadAvg: [0.1, 0.2, 0.3],
          totalMemMb: 1024,
          freeMemMb: 512,
          cpuUsagePercent: 10,
          cpuAverageUsagePercent: 15,
          cpuPeakCoreUsagePercent: 20,
          memoryUsagePercent: 50,
          diskUsagePercent: 40,
          swapUsagePercent: 5,
          networkUsagePercent: 2,
        },
      },
    };

    const merged = mergeCpuDialIntoHealthPayload(basePayload, {
      cpuUsagePercent: Number.NaN,
      cpuAverageUsagePercent: Number.POSITIVE_INFINITY,
      cpuPeakCoreUsagePercent: Number.NEGATIVE_INFINITY,
    });

    expect(merged.health?.host.cpuUsagePercent).toBeNull();
    expect(merged.health?.host.cpuAverageUsagePercent).toBeNull();
    expect(merged.health?.host.cpuPeakCoreUsagePercent).toBeNull();
  });

  it("returns original payload unchanged when health is missing", () => {
    const basePayload = { meta: { generatedAt: "2026-05-15T00:00:00.000Z" } };

    const merged = mergeCpuDialIntoHealthPayload(basePayload, {
      cpuUsagePercent: 42,
      cpuAverageUsagePercent: 39,
      cpuPeakCoreUsagePercent: 71,
    });

    expect(merged).toEqual(basePayload);
  });
});
