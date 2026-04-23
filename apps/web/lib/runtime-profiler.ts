type TimedEvent = {
  atMs: number;
  key: string;
  durationMs: number;
};

type OperationAggregate = {
  operation: string;
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
};

type PrismaProfilingSnapshot = {
  windowSec: number;
  totalQueries: number;
  queriesPerSec: number;
  avgDurationMs: number;
  p95DurationMs: number;
  topOperations: OperationAggregate[];
  totalsSinceBoot: {
    totalQueries: number;
    totalDurationMs: number;
  };
};

type RuntimeProfilingSnapshot = {
  node: {
    uptimeSec: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  prisma: PrismaProfilingSnapshot;
};

const PROFILING_WINDOW_MS = 5 * 60 * 1000;
const MAX_PRISMA_EVENTS = 8_000;
const MAX_TOP_OPERATIONS = 8;

const prismaEvents: TimedEvent[] = [];
let totalPrismaQueriesSinceBoot = 0;
let totalPrismaDurationMsSinceBoot = 0;

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function pruneEvents(events: TimedEvent[], now = Date.now()) {
  const cutoff = now - PROFILING_WINDOW_MS;
  while (events.length > 0 && events[0] && events[0].atMs < cutoff) {
    events.shift();
  }

  if (events.length > MAX_PRISMA_EVENTS) {
    events.splice(0, events.length - MAX_PRISMA_EVENTS);
  }
}

function buildOperationAggregates(events: TimedEvent[]) {
  const grouped = new Map<string, number[]>();

  for (const event of events) {
    const list = grouped.get(event.key);
    if (list) {
      list.push(event.durationMs);
      continue;
    }

    grouped.set(event.key, [event.durationMs]);
  }

  const aggregates: OperationAggregate[] = Array.from(grouped.entries()).map(([operation, durations]) => {
    const totalDurationMs = durations.reduce((acc, value) => acc + value, 0);
    return {
      operation,
      count: durations.length,
      totalDurationMs: round(totalDurationMs, 1),
      avgDurationMs: round(totalDurationMs / Math.max(1, durations.length), 1),
      p95DurationMs: round(percentile(durations, 95), 1),
    };
  });

  aggregates.sort((a, b) => {
    if (b.totalDurationMs !== a.totalDurationMs) {
      return b.totalDurationMs - a.totalDurationMs;
    }

    return b.count - a.count;
  });

  return aggregates.slice(0, MAX_TOP_OPERATIONS);
}

export function recordPrismaOperation(operation: string, durationMs: number) {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const event: TimedEvent = {
    atMs: Date.now(),
    key: operation,
    durationMs: safeDurationMs,
  };

  prismaEvents.push(event);
  totalPrismaQueriesSinceBoot += 1;
  totalPrismaDurationMsSinceBoot += safeDurationMs;
  pruneEvents(prismaEvents, event.atMs);
}

export function getRuntimeProfilingSnapshot(): RuntimeProfilingSnapshot {
  const now = Date.now();
  pruneEvents(prismaEvents, now);

  const windowSec = PROFILING_WINDOW_MS / 1000;
  const durations = prismaEvents.map((event) => event.durationMs);
  const totalDurationMs = durations.reduce((acc, value) => acc + value, 0);

  const memory = process.memoryUsage();

  return {
    node: {
      uptimeSec: round(process.uptime(), 1),
      rssMb: round(memory.rss / 1024 / 1024, 1),
      heapUsedMb: round(memory.heapUsed / 1024 / 1024, 1),
      heapTotalMb: round(memory.heapTotal / 1024 / 1024, 1),
    },
    prisma: {
      windowSec,
      totalQueries: prismaEvents.length,
      queriesPerSec: round(prismaEvents.length / Math.max(1, windowSec), 2),
      avgDurationMs: round(totalDurationMs / Math.max(1, prismaEvents.length), 1),
      p95DurationMs: round(percentile(durations, 95), 1),
      topOperations: buildOperationAggregates(prismaEvents),
      totalsSinceBoot: {
        totalQueries: totalPrismaQueriesSinceBoot,
        totalDurationMs: round(totalPrismaDurationMsSinceBoot, 1),
      },
    },
  };
}
