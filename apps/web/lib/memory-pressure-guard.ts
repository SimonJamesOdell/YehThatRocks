type MemorySnapshot = {
  heapUsedBytes: number;
  heapTotalBytes: number;
  rssBytes: number;
};

type MemoryPressureThresholds = {
  heapUsedRatioThreshold: number;
  rssMbThreshold: number;
};

type MemoryPressureConfig = {
  checkIntervalMs: number;
  cooldownMs: number;
  thresholds: MemoryPressureThresholds;
};

type MemoryReliefState = {
  lastReliefAtMs: number;
};

const DEFAULT_CHECK_INTERVAL_MS = 15_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_HEAP_USED_RATIO_THRESHOLD = 0.74;
const DEFAULT_RSS_MB_THRESHOLD = 200;

let guardStarted = false;
const guardState: MemoryReliefState = {
  lastReliefAtMs: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readNumberEnv(name: string, fallback: number) {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return raw;
}

function getGuardConfig(): MemoryPressureConfig {
  return {
    checkIntervalMs: clamp(
      Math.floor(readNumberEnv("MEMORY_PRESSURE_GUARD_INTERVAL_MS", DEFAULT_CHECK_INTERVAL_MS)),
      5_000,
      120_000,
    ),
    cooldownMs: clamp(
      Math.floor(readNumberEnv("MEMORY_PRESSURE_GUARD_COOLDOWN_MS", DEFAULT_COOLDOWN_MS)),
      10_000,
      10 * 60_000,
    ),
    thresholds: {
      heapUsedRatioThreshold: clamp(
        readNumberEnv("MEMORY_PRESSURE_HEAP_RATIO_THRESHOLD", DEFAULT_HEAP_USED_RATIO_THRESHOLD),
        0.4,
        0.98,
      ),
      rssMbThreshold: clamp(
        Math.floor(readNumberEnv("MEMORY_PRESSURE_RSS_MB_THRESHOLD", DEFAULT_RSS_MB_THRESHOLD)),
        64,
        4096,
      ),
    },
  };
}

export function buildMemorySnapshot(memoryUsage: NodeJS.MemoryUsage): MemorySnapshot {
  return {
    heapUsedBytes: memoryUsage.heapUsed,
    heapTotalBytes: Math.max(1, memoryUsage.heapTotal),
    rssBytes: memoryUsage.rss,
  };
}

export function isMemoryPressureHigh(snapshot: MemorySnapshot, thresholds: MemoryPressureThresholds): boolean {
  const heapUsedRatio = snapshot.heapUsedBytes / Math.max(1, snapshot.heapTotalBytes);
  const rssMb = snapshot.rssBytes / (1024 * 1024);

  return heapUsedRatio >= thresholds.heapUsedRatioThreshold || rssMb >= thresholds.rssMbThreshold;
}

export function shouldRunMemoryRelief(
  snapshot: MemorySnapshot,
  nowMs: number,
  state: MemoryReliefState,
  config: MemoryPressureConfig,
): boolean {
  if (!isMemoryPressureHigh(snapshot, config.thresholds)) {
    return false;
  }

  return nowMs - state.lastReliefAtMs >= config.cooldownMs;
}

async function relieveMemoryPressure(snapshot: MemorySnapshot, nowMs: number) {
  const [
    currentVideoCacheModule,
    videoCacheModule,
    artistCacheModule,
    historyCacheModule,
    favouritesCacheModule,
    runtimeProfilerModule,
  ] = await Promise.all([
    import("@/lib/current-video-cache"),
    import("@/lib/catalog-data-videos"),
    import("@/lib/catalog-data-artists"),
    import("@/lib/catalog-data-history"),
    import("@/lib/catalog-data-favourites"),
    import("@/lib/runtime-profiler"),
  ]);

  currentVideoCacheModule.clearCurrentVideoRouteCaches();
  videoCacheModule.clearVideosCaches();
  artistCacheModule.clearArtistCaches();
  historyCacheModule.clearHistoryCaches();
  favouritesCacheModule.clearFavouritesCaches();
  runtimeProfilerModule.resetRuntimeProfiling();

  guardState.lastReliefAtMs = nowMs;

  const heapUsedMb = Math.round(snapshot.heapUsedBytes / 1024 / 1024);
  const heapTotalMb = Math.round(snapshot.heapTotalBytes / 1024 / 1024);
  const rssMb = Math.round(snapshot.rssBytes / 1024 / 1024);

  console.warn("[memory-pressure-guard] Cache relief applied", {
    heapUsedMb,
    heapTotalMb,
    rssMb,
    at: new Date(nowMs).toISOString(),
  });
}

export async function runMemoryPressureGuardTick(nowMs = Date.now(), config = getGuardConfig()): Promise<boolean> {
  const snapshot = buildMemorySnapshot(process.memoryUsage());

  if (!shouldRunMemoryRelief(snapshot, nowMs, guardState, config)) {
    return false;
  }

  try {
    await relieveMemoryPressure(snapshot, nowMs);
    return true;
  } catch {
    return false;
  }
}

export function startServerMemoryPressureGuard() {
  if (guardStarted) {
    return;
  }

  guardStarted = true;
  const config = getGuardConfig();

  const timer = setInterval(() => {
    void runMemoryPressureGuardTick(Date.now(), config);
  }, config.checkIntervalMs);

  timer.unref?.();
}

export function resetMemoryPressureGuardStateForTests() {
  guardStarted = false;
  guardState.lastReliefAtMs = 0;
}
