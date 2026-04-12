#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic.tsx"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data.ts"),
  newPage: path.join(ROOT, "apps/web/app/(shell)/new/page.tsx"),
  newLoading: path.join(ROOT, "apps/web/app/(shell)/new/loading.tsx"),
  newVideosLoader: path.join(ROOT, "apps/web/components/new-videos-loader.tsx"),
  css: path.join(ROOT, "apps/web/app/globals.css"),
};

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }

  return fs.readFileSync(filePath, "utf8");
}

function assertContains(source, needle, description, failures) {
  if (!source.includes(needle)) {
    failures.push(`${description} (missing: ${needle})`);
  }
}

function assertNotContains(source, needle, description, failures) {
  if (source.includes(needle)) {
    failures.push(`${description} (unexpected: ${needle})`);
  }
}

function main() {
  const failures = [];

  const shellDynamicSource = read(files.shellDynamic);
  const currentVideoRouteSource = read(files.currentVideoRoute);
  const catalogDataSource = read(files.catalogData);
  const newPageSource = read(files.newPage);
  const newLoadingSource = read(files.newLoading);
  const newVideosLoaderSource = read(files.newVideosLoader);
  const cssSource = read(files.css);

  // Watch Next load-more invariants.
  assertContains(shellDynamicSource, "const relatedFetchOffsetRef = useRef<number | null>(null);", "Watch Next tracks a dedicated offset for paged fetches", failures);
  assertContains(shellDynamicSource, "const RELATED_BACKGROUND_PREFETCH_TARGET = 35;", "Watch Next defines a background prefetch target buffer", failures);
  assertContains(shellDynamicSource, "const RELATED_BACKGROUND_PREFETCH_DELAY_MS = 650;", "Watch Next defines a quiet delay before background prefetch", failures);
  assertContains(shellDynamicSource, "displayedRenderableRelatedVideos.length >= RELATED_BACKGROUND_PREFETCH_TARGET", "Watch Next background prefetch stops once the ahead buffer is filled", failures);
  assertContains(shellDynamicSource, "void loadMoreRelatedVideos();", "Watch Next background prefetch triggers additional loads", failures);
  assertContains(shellDynamicSource, "params.set(\"offset\", String(relatedFetchOffsetRef.current));", "Watch Next sends offset-based pagination requests", failures);
  assertContains(shellDynamicSource, "relatedFetchOffsetRef.current = (relatedFetchOffsetRef.current ?? existing.length) + nextVideos.length;", "Watch Next advances offset by server batch size", failures);
  assertContains(shellDynamicSource, "relatedFetchOffsetRef.current = null;", "Watch Next resets offset when the current video changes", failures);
  assertContains(shellDynamicSource, "initialHiddenVideoIds", "Watch Next shell accepts hidden video ids", failures);
  assertContains(shellDynamicSource, "filterHiddenRelatedVideos", "Watch Next shell filters hidden videos from rail", failures);
  assertNotContains(shellDynamicSource, "params.set(\"exclude\"", "Watch Next no longer sends giant exclude id lists in URL", failures);

  // Current-video related pool invariants.
  assertContains(currentVideoRouteSource, "const CURRENT_VIDEO_RELATED_POOL_SIZE = 100;", "Current-video route targets a 100-item related pool", failures);
  assertContains(currentVideoRouteSource, "getTopVideos(300)", "Current-video route widens fallback with Top candidates", failures);
  assertContains(currentVideoRouteSource, "getNewestVideos(200, 0)", "Current-video route widens fallback with New candidates", failures);
  assertContains(currentVideoRouteSource, "getUnseenCatalogVideos({", "Current-video route widens fallback with unseen catalog candidates", failures);
  assertContains(currentVideoRouteSource, "return [...deduped, ...merged].slice(0, CURRENT_VIDEO_RELATED_POOL_SIZE);", "Current-video route enforces bounded merged pool size", failures);

  // Catalog data support invariants for fallback sourcing.
  assertContains(catalogDataSource, "export async function getUnseenCatalogVideos(options?: {", "Catalog data exposes unseen catalog helper", failures);
  assertContains(catalogDataSource, "const requested = Math.max(1, Math.min(500, Math.floor(options?.count ?? 100)));", "Unseen catalog helper validates and clamps requested count", failures);

  // New route non-blocking and staged loading invariants.
  assertContains(newPageSource, 'import { NewVideosLoader } from "@/components/new-videos-loader";', "New page uses client loader for staged fetches", failures);
  assertContains(newPageSource, "<NewVideosLoader", "New page renders client videos loader", failures);
  assertContains(newPageSource, "initialVideos={[]}", "New page passes empty initial payload for quick route open", failures);
  assertContains(newPageSource, "isAuthenticated={isAuthenticated}", "New page passes auth state into client loader", failures);
  assertContains(newPageSource, "seenVideoIds={Array.from(seenVideoIds)}", "New page passes seen ids into client loader", failures);
  assertContains(newPageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "New page passes hidden ids into client loader", failures);
  assertNotContains(newPageSource, "getNewestVideos(", "New page does not block route open on server-side newest query", failures);
  assertContains(newLoadingSource, "Loading new videos...", "New route exposes a dedicated loading state", failures);
  assertContains(newVideosLoaderSource, "fetch(`/api/videos/newest?skip=0&take=10`", "New videos loader performs a fast first-page fetch", failures);
  assertContains(newVideosLoaderSource, "const remainingTake = Math.max(0, 100 - working.length);", "New videos loader backfills remaining slots up to 100", failures);
  assertContains(newVideosLoaderSource, "fetch(`/api/videos/newest?skip=${working.length}&take=${remainingTake}`", "New videos loader fetches a second batch for full list completion", failures);
  assertContains(newVideosLoaderSource, "filterHiddenVideos", "New videos loader filters hidden videos", failures);
  assertNotContains(newVideosLoaderSource, "sortVideosBySeen(", "New videos loader does not reorder rows by seen state", failures);
  assertNotContains(newVideosLoaderSource, "/api/watch-history", "New videos loader does not pad with watch-history rows", failures);

  // Watch Next card title clamp invariants: title must be clamped to 2 lines with ellipsis
  // so that the card height stays consistent and the thumbnail column is not pushed wider.
  assertContains(cssSource, "-webkit-line-clamp: 2;", "Watch Next card title clamped to 2 lines", failures);
  assertContains(cssSource, ".relatedCardSlot .relatedCard h3", "Watch Next card h3 has its own CSS rule", failures);

  if (failures.length > 0) {
    console.error("Watch Next + New invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Watch Next + New invariant check passed.");
}

main();
