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
  top100VideosLoader: path.join(ROOT, "apps/web/components/top100-videos-loader.tsx"),
  seenToggleHook: path.join(ROOT, "apps/web/components/use-seen-toggle-preference.ts"),
  seenToggleRoute: path.join(ROOT, "apps/web/app/api/seen-toggle-preferences/route.ts"),
  seenToggleData: path.join(ROOT, "apps/web/lib/seen-toggle-preference-data.ts"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
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
  const top100VideosLoaderSource = read(files.top100VideosLoader);
  const seenToggleHookSource = read(files.seenToggleHook);
  const seenToggleRouteSource = read(files.seenToggleRoute);
  const seenToggleDataSource = read(files.seenToggleData);
  const apiSchemasSource = read(files.apiSchemas);
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

  // Seen-toggle persistence invariants for New/Top100/Watch Next.
  assertContains(newVideosLoaderSource, "useSeenTogglePreference", "New videos loader uses shared seen-toggle persistence hook", failures);
  assertContains(newVideosLoaderSource, "key: NEW_HIDE_SEEN_TOGGLE_KEY", "New videos loader stores preference under New-specific key", failures);
  assertContains(newVideosLoaderSource, "isAuthenticated,", "New videos loader passes auth state into seen-toggle hook", failures);
  assertContains(top100VideosLoaderSource, "useSeenTogglePreference", "Top 100 loader uses shared seen-toggle persistence hook", failures);
  assertContains(top100VideosLoaderSource, "key: TOP100_HIDE_SEEN_TOGGLE_KEY", "Top 100 loader stores preference under Top 100 key", failures);
  assertContains(shellDynamicSource, "useSeenTogglePreference", "Watch Next shell uses shared seen-toggle persistence hook", failures);
  assertContains(shellDynamicSource, "key: WATCH_NEXT_HIDE_SEEN_TOGGLE_KEY", "Watch Next shell stores preference under Watch Next key", failures);

  assertContains(seenToggleHookSource, 'fetch(`/api/seen-toggle-preferences?key=${encodeURIComponent(key)}`', "Seen-toggle hook fetches authenticated preference values from API", failures);
  assertContains(seenToggleHookSource, "void fetch(\"/api/seen-toggle-preferences\"", "Seen-toggle hook posts updated preference values to API", failures);
  assertContains(seenToggleRouteSource, "requireApiAuth", "Seen-toggle preference API requires authentication", failures);
  assertContains(seenToggleRouteSource, "verifySameOrigin", "Seen-toggle preference API enforces same-origin checks for mutations", failures);
  assertContains(seenToggleRouteSource, "seenTogglePreferenceMutationSchema.safeParse", "Seen-toggle preference API validates mutation payloads", failures);
  assertContains(seenToggleDataSource, "CREATE TABLE IF NOT EXISTS user_seen_toggle_preferences", "Seen-toggle preference data layer bootstraps persistence table", failures);
  assertContains(seenToggleDataSource, "ON DUPLICATE KEY UPDATE", "Seen-toggle preference writes are upserted per user/key", failures);
  assertContains(apiSchemasSource, "seenTogglePreferenceKeySchema", "API schemas define a dedicated seen-toggle key schema", failures);

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
