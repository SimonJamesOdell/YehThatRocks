import fs from "node:fs/promises";
import os from "node:os";

import { prisma } from "@/lib/db";

type NetworkSample = {
  ts: number;
  totalBytes: number;
};

type CpuSnapshot = {
  totalTicks: number;
  idleTicks: number;
  coreSamples: Array<{ totalTicks: number; idleTicks: number }>;
};

type CpuUsageMetrics = {
  currentPercent: number | null;
  averagePercent: number | null;
  pressurePercent: number | null;
  peakCorePercent: number | null;
};

type CpuMinuteBucket = {
  bucketStartMs: number;
  averageSum: number;
  averageSamples: number;
  peakPercent: number;
};

type HostHealthMetrics = {
  platform: string;
  loadAvg: number[];
  totalMemMb: number;
  freeMemMb: number;
  cpuUsagePercent: number | null;
  cpuAverageUsagePercent: number | null;
  cpuPeakCoreUsagePercent: number | null;
  memoryUsagePercent: number;
  diskUsagePercent: number | null;
  swapUsagePercent: number | null;
  networkUsagePercent: number | null;
};

type AdminHostMetricHistoryRow = {
  bucketStart: Date;
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  swapUsagePercent: number | null;
  diskUsagePercent: number | null;
  networkUsagePercent: number | null;
};

let previousNetworkSample: NetworkSample | null = null;
let cpuMinuteHistory: CpuMinuteBucket[] = [];
let adminHostMetricSamplingStarted = false;
let adminHostMetricPersistInFlight: Promise<void> | null = null;
let hostHealthCollectionInFlight: Promise<HostHealthMetrics> | null = null;
let lastPersistedAdminHostMetricBucketStartMs: number | null = null;

const CPU_24H_WINDOW_MS = 24 * 60 * 60 * 1000;
const CPU_BUCKET_MS = 60 * 1000;
const ADMIN_HOST_METRIC_SAMPLE_MS = readPositiveNumberEnv("ADMIN_HOST_METRIC_SAMPLE_INTERVAL_MS", CPU_BUCKET_MS, CPU_BUCKET_MS);

function readPositiveNumberEnv(name: string, defaultValue: number, minValue: number) {
  const raw = process.env[name];
  const parsed = Number(raw ?? defaultValue);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(minValue, parsed);
}

const METRIC_SAMPLE_MS = readPositiveNumberEnv("ADMIN_METRIC_SAMPLE_MS", 200, 50);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function getCurrentBucketStartMs(now = Date.now()) {
  return Math.floor(now / CPU_BUCKET_MS) * CPU_BUCKET_MS;
}

function finitePercentOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? clampPercent(value) : null;
}

function getCpuSnapshot(): CpuSnapshot {
  const cpuTimes = os.cpus();

  return {
    totalTicks: cpuTimes.reduce(
      (acc, core) => acc + core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq,
      0,
    ),
    idleTicks: cpuTimes.reduce((acc, core) => acc + core.times.idle, 0),
    coreSamples: cpuTimes.map((core) => ({
      totalTicks: core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq,
      idleTicks: core.times.idle,
    })),
  };
}

function buildCpuUsageMetrics(start: CpuSnapshot, end: CpuSnapshot): CpuUsageMetrics {
  const totalDiff = end.totalTicks - start.totalTicks;
  const idleDiff = end.idleTicks - start.idleTicks;
  const busyDiff = totalDiff - idleDiff;

  if (totalDiff <= 0) {
    return {
      currentPercent: null,
      averagePercent: null,
      pressurePercent: null,
      peakCorePercent: null,
    };
  }

  const averagePercent = (busyDiff / totalDiff) * 100;
  if (!Number.isFinite(averagePercent)) {
    return {
      currentPercent: null,
      averagePercent: null,
      pressurePercent: null,
      peakCorePercent: null,
    };
  }

  const corePercents = end.coreSamples
    .map((core, index) => {
      const previousCore = start.coreSamples[index];
      if (!previousCore) {
        return null;
      }

      const coreTotalDiff = core.totalTicks - previousCore.totalTicks;
      const coreIdleDiff = core.idleTicks - previousCore.idleTicks;
      if (coreTotalDiff <= 0) {
        return null;
      }

      const corePercent = ((coreTotalDiff - coreIdleDiff) / coreTotalDiff) * 100;
      return Number.isFinite(corePercent) ? clampPercent(corePercent) : null;
    })
    .filter((value): value is number => value !== null);

  const pressurePercent = corePercents.length
    ? Math.sqrt(corePercents.reduce((sum, value) => sum + value * value, 0) / corePercents.length)
    : averagePercent;
  const samplePeakCorePercent = corePercents.length ? Math.max(...corePercents) : averagePercent;

  const now = Date.now();
  const cutoff = now - CPU_24H_WINDOW_MS;
  const currentBucketStartMs = Math.floor(now / CPU_BUCKET_MS) * CPU_BUCKET_MS;
  cpuMinuteHistory = cpuMinuteHistory.filter((entry) => entry.bucketStartMs >= cutoff);

  const clampedSamplePeak = clampPercent(samplePeakCorePercent);
  const clampedSampleAverage = clampPercent(averagePercent);

  if (Number.isFinite(clampedSampleAverage) && Number.isFinite(clampedSamplePeak)) {
    const existingBucket = cpuMinuteHistory.find((entry) => entry.bucketStartMs === currentBucketStartMs);

    if (existingBucket) {
      existingBucket.averageSum += clampedSampleAverage;
      existingBucket.averageSamples += 1;
      existingBucket.peakPercent = Math.max(existingBucket.peakPercent, clampedSamplePeak);
    } else {
      cpuMinuteHistory.push({
        bucketStartMs: currentBucketStartMs,
        averageSum: clampedSampleAverage,
        averageSamples: 1,
        peakPercent: clampedSamplePeak,
      });
    }
  }

  const completedBuckets = cpuMinuteHistory.filter((entry) => entry.bucketStartMs < currentBucketStartMs);
  const sourceBuckets = completedBuckets.length > 0 ? completedBuckets : cpuMinuteHistory;

  const peakCorePercent = sourceBuckets.length
    ? Math.max(...sourceBuckets.map((entry) => entry.peakPercent))
    : clampedSamplePeak;

  const totalAverageSum = sourceBuckets.reduce((sum, entry) => sum + entry.averageSum, 0);
  const totalAverageSamples = sourceBuckets.reduce((sum, entry) => sum + entry.averageSamples, 0);
  const rollingAveragePercent = totalAverageSamples > 0
    ? totalAverageSum / totalAverageSamples
    : clampedSampleAverage;

  return {
    currentPercent: clampPercent(averagePercent),
    averagePercent: clampPercent(rollingAveragePercent),
    pressurePercent: clampPercent(pressurePercent),
    peakCorePercent: clampPercent(peakCorePercent),
  };
}

async function readLinuxNetworkTotalBytes() {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const raw = await fs.readFile("/proc/net/dev", "utf8");
    const lines = raw.split("\n").slice(2).map((line) => line.trim()).filter(Boolean);
    let totalRx = 0;
    let totalTx = 0;

    for (const line of lines) {
      const [ifaceWithColon, stats] = line.split(":");
      const iface = ifaceWithColon?.trim();
      if (!iface || iface === "lo") {
        continue;
      }

      const parts = stats.trim().split(/\s+/);
      const rx = Number(parts[0] ?? 0);
      const tx = Number(parts[8] ?? 0);
      if (Number.isFinite(rx)) {
        totalRx += rx;
      }
      if (Number.isFinite(tx)) {
        totalTx += tx;
      }
    }

    return totalRx + totalTx;
  } catch {
    return null;
  }
}

async function computeNetworkUsagePercent() {
  const totalBytes = await readLinuxNetworkTotalBytes();
  if (totalBytes === null) {
    return null;
  }

  const now = Date.now();
  const current: NetworkSample = { ts: now, totalBytes };
  const prev = previousNetworkSample;
  previousNetworkSample = current;

  if (!prev || now <= prev.ts || totalBytes < prev.totalBytes) {
    await sleep(METRIC_SAMPLE_MS);
    const sampledTotalBytes = await readLinuxNetworkTotalBytes();
    const sampledNow = Date.now();

    if (sampledTotalBytes === null || sampledNow <= now || sampledTotalBytes < totalBytes) {
      return null;
    }

    previousNetworkSample = { ts: sampledNow, totalBytes: sampledTotalBytes };
    const bytesPerSec = (sampledTotalBytes - totalBytes) / ((sampledNow - now) / 1000);
    const maxBytesPerSec = Number(process.env.ADMIN_NETWORK_DIAL_MAX_BYTES_PER_SEC || "12500000");
    if (!Number.isFinite(bytesPerSec) || !Number.isFinite(maxBytesPerSec) || maxBytesPerSec <= 0) {
      return null;
    }

    return clampPercent((bytesPerSec / maxBytesPerSec) * 100);
  }

  const bytesPerSec = (totalBytes - prev.totalBytes) / ((now - prev.ts) / 1000);
  const maxBytesPerSec = Number(process.env.ADMIN_NETWORK_DIAL_MAX_BYTES_PER_SEC || "12500000");
  if (!Number.isFinite(bytesPerSec) || !Number.isFinite(maxBytesPerSec) || maxBytesPerSec <= 0) {
    return null;
  }

  return clampPercent((bytesPerSec / maxBytesPerSec) * 100);
}

function decodeMountField(value: string) {
  // Linux mount tables escape spaces/tabs/newlines as octal codes.
  return value
    .replaceAll("\\040", " ")
    .replaceAll("\\011", "\t")
    .replaceAll("\\012", "\n")
    .replaceAll("\\134", "\\");
}

async function resolveLinuxMountPointForDevice(device: string) {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const raw = await fs.readFile("/proc/self/mounts", "utf8");
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      const parts = line.split(" ");
      const mountedDevice = decodeMountField(parts[0] ?? "");
      const mountPoint = decodeMountField(parts[1] ?? "");

      if (mountedDevice === device && mountPoint) {
        return mountPoint;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function computeDiskUsagePercent() {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const targetDevice = (process.env.ADMIN_DISK_DIAL_DEVICE || "/dev/vda1").trim();
    const mountPoint = targetDevice
      ? (await resolveLinuxMountPointForDevice(targetDevice)) ?? "/"
      : "/";
    const stats = await fs.statfs(mountPoint);
    const blockSize = Number(stats.bsize);
    const totalBlocks = Number(stats.blocks);
    const availableBlocks = Number(stats.bavail ?? stats.bfree);

    if (!Number.isFinite(blockSize) || !Number.isFinite(totalBlocks) || totalBlocks <= 0 || !Number.isFinite(availableBlocks)) {
      return null;
    }

    const totalBytes = totalBlocks * blockSize;
    const availableBytes = Math.max(0, availableBlocks * blockSize);
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    return clampPercent((usedBytes / totalBytes) * 100);
  } catch {
    return null;
  }
}

async function computeSwapUsagePercent() {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const raw = await fs.readFile("/proc/meminfo", "utf8");
    const totalMatch = raw.match(/^SwapTotal:\s+(\d+)\s+kB$/m);
    const freeMatch = raw.match(/^SwapFree:\s+(\d+)\s+kB$/m);
    const totalKb = Number(totalMatch?.[1] ?? 0);
    const freeKb = Number(freeMatch?.[1] ?? 0);

    if (!Number.isFinite(totalKb) || !Number.isFinite(freeKb) || totalKb < 0 || freeKb < 0) {
      return null;
    }

    if (totalKb === 0) {
      return 0;
    }

    const usedKb = Math.max(0, totalKb - freeKb);
    return clampPercent((usedKb / totalKb) * 100);
  } catch {
    return null;
  }
}

async function computeCpuUsagePercent() {
  const sampleWindows = [METRIC_SAMPLE_MS, 400, 750];

  for (const windowMs of sampleWindows) {
    const startSnapshot = getCpuSnapshot();
    await sleep(windowMs);
    const endSnapshot = getCpuSnapshot();
    const metrics = buildCpuUsageMetrics(startSnapshot, endSnapshot);

    if (metrics.averagePercent !== null) {
      return metrics;
    }
  }

  return { currentPercent: 0, averagePercent: 0, pressurePercent: 0, peakCorePercent: 0 };
}

async function collectHostHealthMetrics() {
  if (hostHealthCollectionInFlight) {
    return hostHealthCollectionInFlight;
  }

  const collectionPromise = (async (): Promise<HostHealthMetrics> => {
    const cpuMetrics = await computeCpuUsagePercent();
    const networkUsagePercent = await computeNetworkUsagePercent();
    const diskUsagePercent = await computeDiskUsagePercent();
    const swapUsagePercent = await computeSwapUsagePercent();
    const memoryUsagePercent = clampPercent(
      ((os.totalmem() - os.freemem()) / Math.max(1, os.totalmem())) * 100,
    );
    const cpuUsagePercent = cpuMetrics.currentPercent ?? 0;

    return {
      platform: process.platform,
      loadAvg: os.loadavg(),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      cpuUsagePercent: finitePercentOrNull(cpuUsagePercent),
      cpuAverageUsagePercent: finitePercentOrNull(cpuMetrics.averagePercent),
      cpuPeakCoreUsagePercent: finitePercentOrNull(cpuMetrics.peakCorePercent),
      memoryUsagePercent: clampPercent(memoryUsagePercent),
      diskUsagePercent: finitePercentOrNull(diskUsagePercent),
      swapUsagePercent: finitePercentOrNull(swapUsagePercent),
      networkUsagePercent: finitePercentOrNull(networkUsagePercent),
    };
  })();

  hostHealthCollectionInFlight = collectionPromise;

  try {
    return await collectionPromise;
  } finally {
    if (hostHealthCollectionInFlight === collectionPromise) {
      hostHealthCollectionInFlight = null;
    }
  }
}

async function persistAdminHostMetricSample() {
  if (!process.env.DATABASE_URL) {
    return;
  }

  const bucketStartMs = getCurrentBucketStartMs();
  if (lastPersistedAdminHostMetricBucketStartMs === bucketStartMs) {
    return;
  }

  if (adminHostMetricPersistInFlight) {
    return adminHostMetricPersistInFlight;
  }

  const persistPromise = (async () => {
    const hostMetrics = await collectHostHealthMetrics();
    const persistedBucketStartMs = getCurrentBucketStartMs();
    const bucketStart = new Date(persistedBucketStartMs);
    const cutoff = new Date(Date.now() - CPU_24H_WINDOW_MS);

    await prisma.$executeRaw`
      INSERT INTO admin_host_metric_samples (
        bucket_start,
        cpu_usage_percent,
        cpu_average_usage_percent,
        cpu_peak_core_usage_percent,
        memory_usage_percent,
        disk_usage_percent,
        swap_usage_percent,
        network_usage_percent
      ) VALUES (
        ${bucketStart},
        ${hostMetrics.cpuUsagePercent},
        ${hostMetrics.cpuAverageUsagePercent},
        ${hostMetrics.cpuPeakCoreUsagePercent},
        ${hostMetrics.memoryUsagePercent},
        ${hostMetrics.diskUsagePercent},
        ${hostMetrics.swapUsagePercent},
        ${hostMetrics.networkUsagePercent}
      )
      ON DUPLICATE KEY UPDATE
        cpu_usage_percent = VALUES(cpu_usage_percent),
        cpu_average_usage_percent = VALUES(cpu_average_usage_percent),
        cpu_peak_core_usage_percent = VALUES(cpu_peak_core_usage_percent),
        memory_usage_percent = VALUES(memory_usage_percent),
        disk_usage_percent = VALUES(disk_usage_percent),
        swap_usage_percent = VALUES(swap_usage_percent),
        network_usage_percent = VALUES(network_usage_percent),
        updated_at = CURRENT_TIMESTAMP(3)
    `;

    await prisma.$executeRaw`
      DELETE FROM admin_host_metric_samples
      WHERE bucket_start < ${cutoff}
    `;

    lastPersistedAdminHostMetricBucketStartMs = persistedBucketStartMs;
  })()
    .catch(() => {
      // Ignore persistence failures and keep dashboard health reads working.
    })
    .finally(() => {
      if (adminHostMetricPersistInFlight === persistPromise) {
        adminHostMetricPersistInFlight = null;
      }
    });

  adminHostMetricPersistInFlight = persistPromise;
  return persistPromise;
}

export function startAdminHostMetricSampling() {
  if (adminHostMetricSamplingStarted || !process.env.DATABASE_URL) {
    return;
  }

  adminHostMetricSamplingStarted = true;
  void persistAdminHostMetricSample();

  const timer = setInterval(() => {
    void persistAdminHostMetricSample();
  }, ADMIN_HOST_METRIC_SAMPLE_MS);

  timer.unref?.();
}

export async function readAdminHostMetricHistory() {
  if (!process.env.DATABASE_URL) {
    return [] as Array<{
      bucketStart: string;
      cpuUsagePercent: number | null;
      memoryUsagePercent: number | null;
      swapUsagePercent: number | null;
      diskUsagePercent: number | null;
      networkUsagePercent: number | null;
    }>;
  }

  const cutoff = new Date(Date.now() - CPU_24H_WINDOW_MS);

  const rows = await prisma.$queryRaw<Array<AdminHostMetricHistoryRow>>`
    SELECT
      bucket_start AS bucketStart,
      cpu_usage_percent AS cpuUsagePercent,
      memory_usage_percent AS memoryUsagePercent,
      swap_usage_percent AS swapUsagePercent,
      disk_usage_percent AS diskUsagePercent,
      network_usage_percent AS networkUsagePercent
    FROM admin_host_metric_samples
    WHERE bucket_start >= ${cutoff}
    ORDER BY bucket_start ASC
  `.catch(() => []);

  return rows.map((row) => ({
    bucketStart: row.bucketStart instanceof Date ? row.bucketStart.toISOString() : new Date(row.bucketStart).toISOString(),
    cpuUsagePercent: finitePercentOrNull(row.cpuUsagePercent),
    memoryUsagePercent: finitePercentOrNull(row.memoryUsagePercent),
    swapUsagePercent: finitePercentOrNull(row.swapUsagePercent),
    diskUsagePercent: finitePercentOrNull(row.diskUsagePercent),
    networkUsagePercent: finitePercentOrNull(row.networkUsagePercent),
  }));
}

export async function buildAdminHealthPayload() {
  startAdminHostMetricSampling();
  const hostMetrics = await collectHostHealthMetrics();

  return {
    meta: {
      generatedAt: new Date().toISOString(),
    },
    health: {
      nodeUptimeSec: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
      host: {
        platform: hostMetrics.platform,
        loadAvg: hostMetrics.loadAvg,
        totalMemMb: hostMetrics.totalMemMb,
        freeMemMb: hostMetrics.freeMemMb,
        cpuUsagePercent: hostMetrics.cpuUsagePercent,
        cpuAverageUsagePercent: hostMetrics.cpuAverageUsagePercent,
        cpuPeakCoreUsagePercent: hostMetrics.cpuPeakCoreUsagePercent,
        memoryUsagePercent: hostMetrics.memoryUsagePercent,
        diskUsagePercent: hostMetrics.diskUsagePercent,
        swapUsagePercent: hostMetrics.swapUsagePercent,
        networkUsagePercent: hostMetrics.networkUsagePercent,
      },
    },
  };
}