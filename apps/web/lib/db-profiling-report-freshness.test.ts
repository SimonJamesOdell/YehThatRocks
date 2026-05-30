import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDbProfilingReportFreshness,
  getDbProfilingReportFreshness,
  resetDbProfilingReportFreshnessCacheForTests,
} from "@/lib/db-profiling-report-freshness";

function createTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeReport(dir: string, name: string, mtimeIso: string) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, "report", "utf8");
  const date = new Date(mtimeIso);
  fs.utimesSync(filePath, date, date);
  return filePath;
}

function writeRichReport(dir: string, name: string, mtimeIso: string, content: string) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  const date = new Date(mtimeIso);
  fs.utimesSync(filePath, date, date);
  return filePath;
}

function cleanupDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

afterEach(() => {
  resetDbProfilingReportFreshnessCacheForTests();
});

describe("db profiling report freshness", () => {
  it("marks report as fresh when latest file age is within threshold", () => {
    const payload = buildDbProfilingReportFreshness(
      {
        file: "/tmp/db-profiling-report-20260520-120000.txt",
        mtimeMs: new Date("2026-05-25T10:00:00.000Z").getTime(),
      },
      new Date("2026-05-25T12:00:00.000Z").getTime(),
      72,
    );

    expect(payload.status).toBe("fresh");
    expect(payload.isStale).toBe(false);
    expect(payload.ageHours).toBe(2);
    expect(payload.slowQueryLogStatus).toBe("UNKNOWN");
    expect(payload.hasActionableSlowLogData).toBe(false);
  });

  it("marks report as stale when latest file age exceeds threshold", () => {
    const payload = buildDbProfilingReportFreshness(
      {
        file: "/tmp/db-profiling-report-20260501-120000.txt",
        mtimeMs: new Date("2026-05-01T12:00:00.000Z").getTime(),
      },
      new Date("2026-05-25T12:00:00.000Z").getTime(),
      72,
    );

    expect(payload.status).toBe("stale");
    expect(payload.isStale).toBe(true);
    expect(payload.ageHours).toBeGreaterThan(72);
    expect(payload.summary).toContain("stale");
  });

  it("reports missing when no profiling file exists", () => {
    const payload = buildDbProfilingReportFreshness(
      null,
      new Date("2026-05-25T12:00:00.000Z").getTime(),
      72,
    );

    expect(payload.status).toBe("missing");
    expect(payload.isStale).toBe(true);
    expect(payload.latestReportFile).toBeNull();
    expect(payload.ageHours).toBeNull();
    expect(payload.summary).toBe("No DB profiling report found.");
  });

  it("parses report metadata and flags non-actionable slow-log snapshots", () => {
    const dir = createTempDir("ytr-prof-meta-");

    try {
      const reportPath = writeRichReport(
        dir,
        "db-profiling-report-20260530-183228.txt",
        "2026-05-30T18:32:28.000Z",
        `[profiling] report generated UTC: 2026-05-30 18:32:28\n[profiling] sample started UTC: 2026-05-02 10:00:00\n\n=== MySQL slow query runtime settings ===\nslow_query_log\tOFF\n`,
      );

      const payload = getDbProfilingReportFreshness({
        nowMs: new Date("2026-05-30T18:32:28.000Z").getTime(),
        staleAfterHours: 72,
        cacheTtlMs: 1_000,
        searchDirs: [dir],
      });

      expect(payload.latestReportFile).toBe(reportPath);
      expect(payload.reportGeneratedAt).toBe("2026-05-30T18:32:28.000Z");
      expect(payload.sampleStartedAt).toBe("2026-05-02T10:00:00.000Z");
      expect(payload.sampleAgeHours).toBe(680.54);
      expect(payload.slowQueryLogStatus).toBe("OFF");
      expect(payload.hasActionableSlowLogData).toBe(false);
      expect(payload.summary).toContain("slow_query_log OFF");
      expect(payload.summary).toContain("Capture window started 680.54h ago");
    } finally {
      cleanupDir(dir);
    }
  });

  it("finds newest db-profiling report across search dirs", () => {
    const dirOne = createTempDir("ytr-prof-a-");
    const dirTwo = createTempDir("ytr-prof-b-");

    try {
      writeReport(dirOne, "db-profiling-report-20260505-120000.txt", "2026-05-05T12:00:00.000Z");
      const newestPath = writeReport(dirTwo, "db-profiling-report-20260525-010000.txt", "2026-05-25T01:00:00.000Z");

      const payload = getDbProfilingReportFreshness({
        nowMs: new Date("2026-05-25T12:00:00.000Z").getTime(),
        staleAfterHours: 72,
        cacheTtlMs: 1_000,
        searchDirs: [dirOne, dirTwo],
      });

      expect(payload.status).toBe("fresh");
      expect(payload.latestReportFile).toBe(newestPath);
      expect(payload.latestReportAt).toBe("2026-05-25T01:00:00.000Z");
    } finally {
      cleanupDir(dirOne);
      cleanupDir(dirTwo);
    }
  });

  it("caches freshness result until TTL expires", () => {
    const dirOne = createTempDir("ytr-prof-cache-");

    try {
      const firstPath = writeReport(dirOne, "db-profiling-report-20260520-010000.txt", "2026-05-20T01:00:00.000Z");

      const first = getDbProfilingReportFreshness({
        nowMs: new Date("2026-05-25T12:00:00.000Z").getTime(),
        staleAfterHours: 72,
        cacheTtlMs: 10_000,
        searchDirs: [dirOne],
      });

      const secondPath = writeReport(dirOne, "db-profiling-report-20260525-110000.txt", "2026-05-25T11:00:00.000Z");

      const cached = getDbProfilingReportFreshness({
        nowMs: new Date("2026-05-25T12:00:05.000Z").getTime(),
        staleAfterHours: 72,
        cacheTtlMs: 10_000,
        searchDirs: [dirOne],
      });

      const refreshed = getDbProfilingReportFreshness({
        nowMs: new Date("2026-05-25T12:00:11.000Z").getTime(),
        staleAfterHours: 72,
        cacheTtlMs: 10_000,
        searchDirs: [dirOne],
      });

      expect(first.latestReportFile).toBe(firstPath);
      expect(cached.latestReportFile).toBe(firstPath);
      expect(refreshed.latestReportFile).toBe(secondPath);
    } finally {
      cleanupDir(dirOne);
    }
  });
});
