import fs from "node:fs";
import path from "node:path";

import { clamp, readPositiveIntEnv } from "@/lib/number-utils";

export type DbProfilingReportFreshness = {
  status: "fresh" | "stale" | "missing";
  latestReportFile: string | null;
  latestReportAt: string | null;
  reportGeneratedAt: string | null;
  sampleStartedAt: string | null;
  sampleAgeHours: number | null;
  slowQueryLogStatus: "ON" | "OFF" | "UNKNOWN";
  hasActionableSlowLogData: boolean;
  summary: string;
  ageHours: number | null;
  staleAfterHours: number;
  isStale: boolean;
  checkedAt: string;
};

type ParsedReportMetadata = {
  reportGeneratedAt: string | null;
  sampleStartedAt: string | null;
  slowQueryLogStatus: "ON" | "OFF" | "UNKNOWN";
};

type FreshnessCacheEntry = {
  expiresAtMs: number;
  payload: DbProfilingReportFreshness;
};

type FreshnessOptions = {
  nowMs?: number;
  searchDirs?: string[];
  staleAfterHours?: number;
  cacheTtlMs?: number;
};

const DB_PROFILING_REPORT_FILENAME_RE = /^db-profiling-report-\d{8}-\d{6}\.txt$/i;
const DEFAULT_STALE_AFTER_HOURS = 72;
const DEFAULT_CACHE_TTL_MS = 30_000;

let freshnessCache: FreshnessCacheEntry | null = null;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readStaleAfterHoursFromEnv() {
  const value = readPositiveIntEnv(
    "DB_PROFILING_REPORT_STALE_AFTER_HOURS",
    DEFAULT_STALE_AFTER_HOURS,
    1,
    24 * 365,
  );
  return clamp(value, 1, 24 * 365);
}

function readCacheTtlMsFromEnv() {
  return readPositiveIntEnv(
    "DB_PROFILING_REPORT_FRESHNESS_CACHE_TTL_MS",
    DEFAULT_CACHE_TTL_MS,
    1_000,
    10 * 60_000,
  );
}

function resolveSearchDirs(cwd = process.cwd()) {
  const dirs = new Set<string>();
  let current = path.resolve(cwd);

  for (let depth = 0; depth < 4; depth += 1) {
    dirs.add(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return Array.from(dirs);
}

function findLatestReportMtimeMs(searchDirs: string[]): { file: string; mtimeMs: number } | null {
  let latest: { file: string; mtimeMs: number } | null = null;

  for (const dir of searchDirs) {
    let entries: string[];

    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!DB_PROFILING_REPORT_FILENAME_RE.test(entry)) {
        continue;
      }

      const absolutePath = path.join(dir, entry);
      let stat: fs.Stats;

      try {
        stat = fs.statSync(absolutePath);
      } catch {
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }

      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = {
          file: absolutePath,
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  }

  return latest;
}

function parseProfilingTimestamp(value: string) {
  const isoCandidate = value.trim().replace(" ", "T");
  const parsed = Date.parse(`${isoCandidate}Z`);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function parseLatestReportMetadata(file: string): ParsedReportMetadata {
  let content = "";

  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return {
      reportGeneratedAt: null,
      sampleStartedAt: null,
      slowQueryLogStatus: "UNKNOWN",
    };
  }

  const generatedMatch = content.match(/^\[profiling\] report generated UTC: (.+)$/m);
  const sampleStartedMatch = content.match(/^\[profiling\] sample started UTC: (.+)$/m);
  const slowQueryMatch = content.match(/^slow_query_log\s+(ON|OFF)$/mi);

  return {
    reportGeneratedAt: generatedMatch ? parseProfilingTimestamp(generatedMatch[1]) : null,
    sampleStartedAt: sampleStartedMatch ? parseProfilingTimestamp(sampleStartedMatch[1]) : null,
    slowQueryLogStatus: slowQueryMatch ? slowQueryMatch[1].toUpperCase() as "ON" | "OFF" : "UNKNOWN",
  };
}

export function buildDbProfilingReportFreshness(
  latest: { file: string; mtimeMs: number } | null,
  nowMs: number,
  staleAfterHours: number,
): DbProfilingReportFreshness {
  const checkedAt = new Date(nowMs).toISOString();

  if (!latest) {
    return {
      status: "missing",
      latestReportFile: null,
      latestReportAt: null,
      reportGeneratedAt: null,
      sampleStartedAt: null,
      sampleAgeHours: null,
      slowQueryLogStatus: "UNKNOWN",
      hasActionableSlowLogData: false,
      summary: "No DB profiling report found.",
      ageHours: null,
      staleAfterHours,
      isStale: true,
      checkedAt,
    };
  }

  const metadata = parseLatestReportMetadata(latest.file);
  const ageHours = round(Math.max(0, nowMs - latest.mtimeMs) / (1000 * 60 * 60), 2);
  const isStale = ageHours > staleAfterHours;
  const sampleStartedAtMs = metadata.sampleStartedAt ? Date.parse(metadata.sampleStartedAt) : null;
  const sampleAgeHours = sampleStartedAtMs == null
    ? null
    : round(Math.max(0, nowMs - sampleStartedAtMs) / (1000 * 60 * 60), 2);
  const hasActionableSlowLogData = metadata.slowQueryLogStatus === "ON";

  let summary = isStale
    ? `DB profiling report is stale (${ageHours}h old).`
    : `DB profiling report is fresh (${ageHours}h old).`;

  if (metadata.slowQueryLogStatus === "OFF") {
    summary += " Latest report was generated with slow_query_log OFF, so current DB hotspots are only partially observable.";
  } else if (metadata.slowQueryLogStatus === "UNKNOWN") {
    summary += " Slow query log state could not be determined from the latest report.";
  }

  if (sampleAgeHours != null) {
    summary += ` Capture window started ${sampleAgeHours}h ago.`;
  }

  return {
    status: isStale ? "stale" : "fresh",
    latestReportFile: latest.file,
    latestReportAt: new Date(latest.mtimeMs).toISOString(),
    reportGeneratedAt: metadata.reportGeneratedAt,
    sampleStartedAt: metadata.sampleStartedAt,
    sampleAgeHours,
    slowQueryLogStatus: metadata.slowQueryLogStatus,
    hasActionableSlowLogData,
    summary,
    ageHours,
    staleAfterHours,
    isStale,
    checkedAt,
  };
}

export function getDbProfilingReportFreshness(options?: FreshnessOptions): DbProfilingReportFreshness {
  const nowMs = options?.nowMs ?? Date.now();
  const staleAfterHours = options?.staleAfterHours ?? readStaleAfterHoursFromEnv();
  const cacheTtlMs = options?.cacheTtlMs ?? readCacheTtlMsFromEnv();

  if (freshnessCache && freshnessCache.expiresAtMs > nowMs) {
    return freshnessCache.payload;
  }

  const searchDirs = options?.searchDirs ?? resolveSearchDirs();
  const latest = findLatestReportMtimeMs(searchDirs);
  const payload = buildDbProfilingReportFreshness(latest, nowMs, staleAfterHours);

  freshnessCache = {
    payload,
    expiresAtMs: nowMs + cacheTtlMs,
  };

  return payload;
}

export function resetDbProfilingReportFreshnessCacheForTests() {
  freshnessCache = null;
}
