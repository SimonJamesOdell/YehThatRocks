#!/usr/bin/env node
// Invariants for shared utility helpers that must not be inlined or duplicated.
// Covers: number-utils (clamp, readPositiveNumberEnv, readPositiveIntEnv, finiteNumberOrNull)

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  numberUtils: path.join(ROOT, "apps/web/lib/number-utils.ts"),
  adminDashboardHealth: path.join(ROOT, "apps/web/lib/admin-dashboard-health.ts"),
  adminDashboardStreamRoute: path.join(ROOT, "apps/web/app/api/admin/dashboard/stream/route.ts"),
  videosTopRoute: path.join(ROOT, "apps/web/app/api/videos/top/route.ts"),
  videosNewestRoute: path.join(ROOT, "apps/web/app/api/videos/newest/route.ts"),
  catalogDataHistory: path.join(ROOT, "apps/web/lib/catalog-data-history.ts"),
  catalogDataArtists: path.join(ROOT, "apps/web/lib/catalog-data-artists.ts"),
};

function main() {
  const failures = [];

  const numberUtilsSource = readFileStrict(files.numberUtils, ROOT);
  const adminDashboardHealthSource = readFileStrict(files.adminDashboardHealth, ROOT);
  const adminDashboardStreamSource = readFileStrict(files.adminDashboardStreamRoute, ROOT);
  const videosTopSource = readFileStrict(files.videosTopRoute, ROOT);
  const videosNewestSource = readFileStrict(files.videosNewestRoute, ROOT);
  const catalogDataHistorySource = readFileStrict(files.catalogDataHistory, ROOT);
  const catalogDataArtistsSource = readFileStrict(files.catalogDataArtists, ROOT);

  // number-utils must export the canonical set of shared numeric helpers.
  assertContains(numberUtilsSource, "export function clamp(", "number-utils exports clamp helper", failures);
  assertContains(numberUtilsSource, "export function finiteNumberOrNull(", "number-utils exports finiteNumberOrNull helper", failures);
  assertContains(numberUtilsSource, "export function clampPercent(", "number-utils exports clampPercent helper", failures);
  assertContains(numberUtilsSource, "export function finitePercentOrNull(", "number-utils exports finitePercentOrNull helper", failures);
  assertContains(numberUtilsSource, "export function readPositiveNumberEnv(", "number-utils exports readPositiveNumberEnv helper", failures);
  assertContains(numberUtilsSource, "export function readPositiveIntEnv(", "number-utils exports readPositiveIntEnv helper", failures);

  // clamp must be imported from number-utils, not redefined inline, across key consumers.
  assertContains(videosTopSource, 'import { clamp } from "@/lib/number-utils"', "videos/top imports clamp from number-utils", failures);
  assertContains(videosNewestSource, 'import { clamp } from "@/lib/number-utils"', "videos/newest imports clamp from number-utils", failures);
  assertContains(catalogDataHistorySource, 'from "@/lib/number-utils"', "catalog-data-history imports from number-utils", failures);
  assertContains(catalogDataArtistsSource, 'from "@/lib/number-utils"', "catalog-data-artists imports from number-utils", failures);

  // clamp must actually be used in files that replaced inline Math.max/min patterns.
  assertContains(videosTopSource, "take = clamp(", "videos/top uses clamp for take clamping", failures);
  assertContains(videosNewestSource, "take = clamp(", "videos/newest uses clamp for take clamping", failures);
  assertContains(catalogDataHistorySource, "clamp(", "catalog-data-history uses clamp helper", failures);
  assertContains(catalogDataArtistsSource, "clamp(", "catalog-data-artists uses clamp helper", failures);

  // readPositiveNumberEnv must be imported from number-utils, not duplicated.
  assertContains(adminDashboardHealthSource, 'from "@/lib/number-utils"', "admin-dashboard-health imports from number-utils", failures);
  assertContains(adminDashboardStreamSource, 'from "@/lib/number-utils"', "admin-dashboard stream route imports from number-utils", failures);
  assertNotContains(adminDashboardHealthSource, "function readPositiveNumberEnv(", "admin-dashboard-health does not locally redefine readPositiveNumberEnv", failures);
  assertNotContains(adminDashboardStreamSource, "function readPositiveNumberEnv(", "admin-dashboard stream route does not locally redefine readPositiveNumberEnv", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Shared-utils invariant check failed.",
    successMessage: "Shared-utils invariant check passed.",
  });
}

main();
