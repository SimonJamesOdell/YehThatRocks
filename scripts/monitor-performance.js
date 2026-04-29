#!/usr/bin/env node
// Continuous 24/7 performance monitor — polls /api/status/performance at a
// configurable interval, appends rows to a daily CSV, and automatically prunes
// rows older than the rolling window so storage never grows unboundedly.
//
// Usage:
//   node scripts/monitor-performance.js [options]
//
// Options:
//   --url=<url>              Base URL to poll   (default: https://yehthatrocks.com)
//   --interval-ms=<ms>      Poll interval       (default: 10000)
//   --window-hours=<hours>  Rolling window      (default: 24)
//   --out-dir=<dir>         Output directory    (default: logs/)
//   --quiet                 Suppress live output

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key) {
      args[key] = value ?? true;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

const BASE_URL = (args["url"] || "https://yehthatrocks.com").replace(/\/$/, "");
const INTERVAL_MS = Math.max(1000, Number(args["interval-ms"] || 10_000));
const WINDOW_HOURS = Math.max(1, Number(args["window-hours"] || 24));
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;
const OUT_DIR = path.resolve(args["out-dir"] || path.join(__dirname, "..", "logs"));
const QUIET = args["quiet"] === true || args["quiet"] === "true";

const PERF_URL = `${BASE_URL}/api/status/performance`;

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  "timestamp",
  "cpu_percent",
  "memory_percent",
  "heap_used_mb",
  "heap_total_mb",
  "rss_mb",
  "disk_percent",
  "swap_percent",
  "network_percent",
  "load_avg_1m",
  "prisma_query_count",
  "prisma_qps",
  "prisma_avg_ms",
  "prisma_p95_ms",
  "prisma_total_since_boot",
  "node_uptime_sec",
];

function toCsvLine(row) {
  return row
    .map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` 
        : s;
    })
    .join(",");
}

function getCsvFilePath(now = new Date()) {
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(OUT_DIR, `perf-monitor-${date}.csv`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendCsvRow(filePath, row) {
  const needsHeader = !fs.existsSync(filePath);
  const line = toCsvLine(row) + "\n";
  if (needsHeader) {
    fs.appendFileSync(filePath, toCsvLine(CSV_HEADERS) + "\n", "utf8");
  }
  fs.appendFileSync(filePath, line, "utf8");
}

// ---------------------------------------------------------------------------
// Rolling window pruning — removes rows older than WINDOW_MS from CSV files
// ---------------------------------------------------------------------------

function pruneOldCsvRows(filePath) {
  if (!fs.existsSync(filePath)) return;

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    if (lines.length < 2) return;

    const header = lines[0];
    const cutoff = Date.now() - WINDOW_MS;
    const kept = [];

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const ts = line.split(",")[0];
      const lineMs = new Date(ts).getTime();
      if (!isNaN(lineMs) && lineMs >= cutoff) {
        kept.push(line);
      }
    }

    // Rewrite only if rows were actually removed
    const originalDataLines = lines.slice(1).filter((l) => l.trim()).length;
    if (kept.length < originalDataLines) {
      const newContent = [header, ...kept].join("\n") + "\n";
      fs.writeFileSync(filePath, newContent, "utf8");
      if (!QUIET) {
        console.log(
          `[prune] Removed ${originalDataLines - kept.length} rows older than ${WINDOW_HOURS}h from ${path.basename(filePath)}`,
        );
      }
    }
  } catch {
    // Best-effort pruning — never crash the monitor
  }
}

function pruneOldCsvFiles() {
  // Remove entire files whose date is beyond the window (e.g. 2+ days ago)
  try {
    const files = fs.readdirSync(OUT_DIR).filter((f) => /^perf-monitor-\d{4}-\d{2}-\d{2}\.csv$/.test(f));
    const cutoffDate = new Date(Date.now() - WINDOW_MS);
    cutoffDate.setHours(0, 0, 0, 0);

    for (const file of files) {
      const dateStr = file.replace("perf-monitor-", "").replace(".csv", "");
      const fileDate = new Date(dateStr);
      if (!isNaN(fileDate.getTime()) && fileDate < cutoffDate) {
        fs.unlinkSync(path.join(OUT_DIR, file));
        if (!QUIET) {
          console.log(`[prune] Deleted old file: ${file}`);
        }
      }
    }
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// HTTP fetch (no external deps)
// ---------------------------------------------------------------------------

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "ytr-perf-monitor/1.0" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

// ---------------------------------------------------------------------------
// Rolling stats for live console output
// ---------------------------------------------------------------------------

const recentCpu = [];
const MAX_RECENT = 60; // last 60 samples for trend display

function pushRecent(arr, value) {
  if (value !== null && value !== undefined && isFinite(value)) {
    arr.push(value);
    if (arr.length > MAX_RECENT) arr.shift();
  }
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function trend(arr) {
  if (arr.length < 2) return 0;
  const n = arr.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += arr[i]; sumXY += i * arr[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom; // slope per sample
}

// ---------------------------------------------------------------------------
// Main poll loop
// ---------------------------------------------------------------------------

let pollCount = 0;
let errorCount = 0;
let lastPrunedMinute = -1;

async function poll() {
  const now = new Date();
  const nowMs = now.getTime();

  let data;
  try {
    data = await fetchJson(PERF_URL);
  } catch (err) {
    errorCount++;
    if (!QUIET) {
      console.error(`[${now.toISOString()}] FETCH ERROR (${errorCount}): ${err.message}`);
    }
    return;
  }

  pollCount++;

  // Extract fields defensively
  const host = data?.host ?? {};
  const prisma = data?.prisma ?? {};
  const runtime = data?.runtime ?? {};

  const cpu = host.cpuUsagePercent ?? null;
  const memPct = host.memoryUsagePercent ?? null;
  const heapUsed = runtime.memory?.heapUsedMb ?? null;
  const heapTotal = runtime.memory?.heapTotalMb ?? null;
  const rss = runtime.memory?.rssMb ?? null;
  const disk = host.diskUsagePercent ?? null;
  const swap = host.swapUsagePercent ?? null;
  const network = host.networkUsagePercent ?? null;
  const loadAvg1 = host.loadAvg?.[0] ?? null;
  const prismaCount = prisma.queryCount ?? null;
  const prismaQps = prisma.qps ?? null;
  const prismaAvg = prisma.avgDurationMs ?? null;
  const prismaP95 = prisma.p95DurationMs ?? null;
  const prismaTotal = prisma.totalsSinceBoot?.totalQueries ?? null;
  const uptime = runtime.uptimeSec ?? null;

  const row = [
    now.toISOString(),
    cpu,
    memPct,
    heapUsed,
    heapTotal,
    rss,
    disk,
    swap,
    network,
    loadAvg1,
    prismaCount,
    prismaQps,
    prismaAvg,
    prismaP95,
    prismaTotal,
    uptime,
  ];

  const csvFile = getCsvFilePath(now);
  appendCsvRow(csvFile, row);

  pushRecent(recentCpu, cpu);

  // Prune once per minute
  const currentMinute = Math.floor(nowMs / 60_000);
  if (currentMinute !== lastPrunedMinute) {
    lastPrunedMinute = currentMinute;
    pruneOldCsvRows(getCsvFilePath(now));
    // Also prune yesterday's file if still in range
    const yesterday = new Date(nowMs - 86_400_000);
    pruneOldCsvRows(getCsvFilePath(yesterday));
    pruneOldCsvFiles();
  }

  if (!QUIET) {
    const cpuStr = cpu !== null ? `${cpu.toFixed(1)}%` : "n/a";
    const memStr = memPct !== null ? `${memPct.toFixed(1)}%` : "n/a";
    const avgCpu = avg(recentCpu);
    const slope = trend(recentCpu);
    const trendStr = slope > 0.05 ? "↑" : slope < -0.05 ? "↓" : "→";
    const prismaStr = prismaCount !== null ? `${prismaCount}q ${prismaQps?.toFixed(2) ?? "?"}qps p95=${prismaP95 ?? "?"}ms` : "n/a";

    process.stdout.write(
      `\r[${now.toISOString().slice(11, 19)}] CPU: ${cpuStr} (avg ${avgCpu?.toFixed(1) ?? "?"}% ${trendStr}) | MEM: ${memStr} | Prisma: ${prismaStr} | polls: ${pollCount} errs: ${errorCount}      `,
    );
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

ensureDir(OUT_DIR);

if (!QUIET) {
  console.log(`YehThatRocks performance monitor`);
  console.log(`  URL:      ${PERF_URL}`);
  console.log(`  Interval: ${INTERVAL_MS}ms`);
  console.log(`  Window:   ${WINDOW_HOURS}h rolling`);
  console.log(`  Output:   ${OUT_DIR}/perf-monitor-YYYY-MM-DD.csv`);
  console.log(`  Ctrl-C to stop\n`);
}

// Run immediately then on interval
void poll();
const timer = setInterval(() => void poll(), INTERVAL_MS);

// ---------------------------------------------------------------------------
// Clean shutdown
// ---------------------------------------------------------------------------

function shutdown() {
  clearInterval(timer);
  if (!QUIET) {
    process.stdout.write("\n");
    console.log(`\nStopped. ${pollCount} polls, ${errorCount} errors.`);
    console.log(`Data written to: ${OUT_DIR}/perf-monitor-YYYY-MM-DD.csv`);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
