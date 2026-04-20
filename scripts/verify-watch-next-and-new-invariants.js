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
  assertContains(shellDynamicSource, "const loadMoreRelatedVideos = useCallback(async (requestedCount = RELATED_LOAD_BATCH_SIZE) => {", "Watch Next load-more accepts caller-provided batch size", failures);
  assertContains(shellDynamicSource, "const batchCount = Math.max(1, Math.min(30, Math.floor(requestedCount)));", "Watch Next clamps requested load-more batch size", failures);
  assertContains(shellDynamicSource, "params.set(\"count\", String(batchCount));", "Watch Next sends adaptive batch size to current-video API", failures);
  assertContains(shellDynamicSource, "const remainingForTarget = RELATED_BACKGROUND_PREFETCH_TARGET - displayedRenderableRelatedVideos.length;", "Watch Next computes remaining background prefetch distance", failures);
  assertContains(shellDynamicSource, "void loadMoreRelatedVideos(prefetchCount);", "Watch Next background prefetch requests the computed target batch", failures);
  assertContains(shellDynamicSource, "void loadMoreRelatedVideos(30);", "Watch Next hide-seen recovery uses an eager refill batch", failures);
  assertContains(shellDynamicSource, "initialHiddenVideoIds", "Watch Next shell accepts hidden video ids", failures);
  assertContains(shellDynamicSource, "filterHiddenRelatedVideos", "Watch Next shell filters hidden videos from rail", failures);
  assertNotContains(shellDynamicSource, "params.set(\"exclude\"", "Watch Next no longer sends giant exclude id lists in URL", failures);

  // Watch Next startup consistency invariants.
  assertContains(shellDynamicSource, "const [hasBootstrappedWatchNext, setHasBootstrappedWatchNext] = useState(false);", "Watch Next tracks a bootstrap gate before first rail render", failures);
  assertContains(shellDynamicSource, "const isWaitingForClientHydration = !hasClientMounted;", "Watch Next blocks bootstrap until client hydration completes", failures);
  assertContains(shellDynamicSource, "const shouldShowWatchNextBootstrapLoader = rightRailMode === \"watch-next\"", "Watch Next computes a dedicated bootstrap loader condition", failures);
  assertContains(shellDynamicSource, "&& (!hasBootstrappedWatchNext || isWatchNextVideoSelectionPending);", "Watch Next keeps bootstrap loader visible until synchronization is complete", failures);
  assertContains(shellDynamicSource, "const currentSignature = displayedRelatedVideos.map((video) => video.id).join(\"|\");", "Watch Next bootstrap compares displayed rail signature", failures);
  assertContains(shellDynamicSource, "const nextSignature = sourceRelatedVideos.map((video) => video.id).join(\"|\");", "Watch Next bootstrap compares source rail signature", failures);
  assertContains(shellDynamicSource, "if (!shouldDisableRelatedRailTransition && displayedRelatedVideos.length > 0) {", "Watch Next bootstrap keeps initial reveal transition when animations are enabled", failures);
  assertContains(shellDynamicSource, "setRelatedTransitionPhase(\"fading-in\");", "Watch Next bootstrap triggers one-time fade-in on first synchronized render", failures);
  assertContains(shellDynamicSource, "setHasBootstrappedWatchNext(true);", "Watch Next only unlocks first render after signatures match", failures);

  // Watch Next redraw-loop regression invariants.
  assertContains(shellDynamicSource, "const currentIds = displayedRelatedVideos.map((video) => video.id);", "Watch Next transition effect snapshots currently displayed ids", failures);
  assertContains(shellDynamicSource, "const nextIds = sourceRelatedVideos.map((video) => video.id);", "Watch Next transition effect snapshots incoming ids", failures);
  assertContains(shellDynamicSource, "const isAppendOnlyUpdate = currentIds.length > 0", "Watch Next detects append-only rail growth", failures);
  assertContains(shellDynamicSource, "&& currentIds.every((id, index) => nextIds[index] === id);", "Watch Next verifies append-only prefix alignment", failures);
  assertContains(shellDynamicSource, "if (isAppendOnlyUpdate) {", "Watch Next branches append-only updates away from fade-in transitions", failures);
  assertContains(shellDynamicSource, "if (relatedTransitionPhase !== \"idle\") {", "Watch Next append-only branch normalizes transition phase", failures);
  assertNotContains(shellDynamicSource, "setRelatedTransitionPhase(\"fading-out\")", "Watch Next no longer re-enters fading-out transition loops", failures);

  // Startup source-of-truth invariants.
  assertContains(shellDynamicSource, "resolveStartupCandidate(initialVideo, initialHydratedRelatedVideos, \"server-initial\");", "Startup selection reuses server-provided initial video and related list", failures);
  assertNotContains(shellDynamicSource, "fetch(`/api/videos/top/random", "Startup no longer performs a second random-fetch path from the shell", failures);
  assertContains(shellDynamicSource, "if (startupHydratedVideoIdRef.current === requestedVideoId) {", "Requested-video guard clears startup hydration sentinel", failures);
  assertContains(shellDynamicSource, "startupHydratedVideoIdRef.current = null;", "Requested-video flow resets startup hydration sentinel to avoid sticky loading state", failures);

  // Current-video related pool invariants.
  assertContains(currentVideoRouteSource, "const CURRENT_VIDEO_RELATED_POOL_SIZE = 100;", "Current-video route targets a 100-item related pool", failures);
  assertContains(currentVideoRouteSource, "getTopVideos(300)", "Current-video route widens fallback with Top candidates", failures);
  assertContains(currentVideoRouteSource, "getNewestVideos(200, 0)", "Current-video route widens fallback with New candidates", failures);
  assertContains(currentVideoRouteSource, "getUnseenCatalogVideos({", "Current-video route widens fallback with unseen catalog candidates", failures);
  assertContains(currentVideoRouteSource, "return [...deduped, ...merged].slice(0, CURRENT_VIDEO_RELATED_POOL_SIZE);", "Current-video route enforces bounded merged pool size", failures);

  // Catalog data support invariants for fallback sourcing.
  assertContains(catalogDataSource, "export async function getUnseenCatalogVideos(options?: {", "Catalog data exposes unseen catalog helper", failures);
  assertContains(catalogDataSource, "const requested = Math.max(1, Math.min(500, Math.floor(options?.count ?? 100)));", "Unseen catalog helper validates and clamps requested count", failures);
  assertContains(catalogDataSource, "const useSharedRelatedCache = excludedIds.size === 0;", "Related videos cache is reused for any exclude-free request size", failures);
  assertContains(catalogDataSource, "if (cached && cached.expiresAt > now && cached.videos.length >= requestedCount)", "Related videos cache serves larger pooled recommendation requests", failures);
  assertContains(catalogDataSource, "const newestPromise = getNewestVideos(50).then((videos) =>", "Related videos reuse newest helper instead of issuing a duplicate newest scan", failures);

  // New route non-blocking and staged loading invariants.
  assertContains(newPageSource, 'import { NewVideosLoader } from "@/components/new-videos-loader";', "New page uses client loader for staged fetches", failures);
  assertContains(newPageSource, "<NewVideosLoader", "New page renders client videos loader", failures);
  assertContains(newPageSource, "initialVideos={[]}", "New page passes empty initial payload for quick route open", failures);
  assertContains(newPageSource, "isAuthenticated={isAuthenticated}", "New page passes auth state into client loader", failures);
  assertContains(newPageSource, "seenVideoIds={Array.from(seenVideoIds)}", "New page passes seen ids into client loader", failures);
  assertContains(newPageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "New page passes hidden ids into client loader", failures);
  assertNotContains(newPageSource, "getNewestVideos(", "New page does not block route open on server-side newest query", failures);
  assertContains(newLoadingSource, "Loading new videos...", "New route exposes a dedicated loading state", failures);
  assertContains(newVideosLoaderSource, "fetch(`/api/videos/newest?skip=${skip}&take=${take}`", "New videos loader uses offset/take pagination for batch fetches", failures);
  assertContains(newVideosLoaderSource, "const payload = (await response.json()) as NewVideosApiPayload;", "New videos loader parses newest API pagination metadata", failures);
  assertContains(newVideosLoaderSource, "nextOffsetRef.current = Number.isFinite(nextOffset) ? nextOffset : skip + received;", "New videos loader advances offset using API-provided nextOffset when available", failures);
  assertContains(newVideosLoaderSource, "const NEW_INITIAL_BATCH_SIZE = 12;", "New videos loader uses smaller initial lazy-load batches", failures);
  assertContains(newVideosLoaderSource, "const NEW_STARTUP_PREFETCH_TARGET = 100;", "New videos loader preloads a 100-video startup runway", failures);
  assertContains(newVideosLoaderSource, "const NEW_PLAYLIST_MAX_ITEMS = 100;", "New videos loader caps New-playlist creation to 100 items", failures);
  assertContains(newVideosLoaderSource, "const NEW_SCROLL_BATCH_SIZE = 10;", "New videos loader uses small incremental batches while scrolling", failures);
  assertContains(newVideosLoaderSource, "const NEW_SCROLL_PREFETCH_THRESHOLD_PX = 1400;", "New videos loader keeps a modest runway ahead near the bottom", failures);
  assertContains(newVideosLoaderSource, "const NEW_SCROLL_START_RATIO = 0.5;", "New videos loader starts additional loading around halfway through scrolling", failures);
  assertContains(newVideosLoaderSource, "type ScrollMetrics = {", "New videos loader tracks scroll metrics from the active scroll container", failures);
  assertContains(newVideosLoaderSource, "await loadBatch(0, NEW_INITIAL_BATCH_SIZE, { initial: true });", "New videos loader performs fast bootstrap with the small initial batch size", failures);
  assertContains(newVideosLoaderSource, "while (nextOffsetRef.current < NEW_STARTUP_PREFETCH_TARGET && hasMoreRef.current)", "New videos loader incrementally warms startup buffer via repeated small fetches", failures);
  assertContains(newVideosLoaderSource, "const [isLoadingMore, setIsLoadingMore] = useState(false);", "New videos loader tracks incremental infinite-scroll loading state", failures);
  assertContains(newVideosLoaderSource, "const [hasMore, setHasMore] = useState(true);", "New videos loader tracks pagination exhaustion", failures);
  assertContains(newVideosLoaderSource, "const emptyBatchStreakRef = useRef(0);", "New videos loader tracks consecutive empty pages before stopping", failures);
  assertContains(newVideosLoaderSource, "const hasMoreRef = useRef(true);", "New videos loader mirrors hasMore in a ref for stable observer callbacks", failures);
  assertContains(newVideosLoaderSource, "const isLoadingMoreRef = useRef(false);", "New videos loader mirrors incremental loading in a ref for stable observer callbacks", failures);
  assertContains(newVideosLoaderSource, "const prefetchInFlightRef = useRef(false);", "New videos loader prevents overlapping ahead-prefetch loops", failures);
  assertContains(newVideosLoaderSource, "const lastPrefetchAtRef = useRef(0);", "New videos loader throttles viewport-driven prefetch checks", failures);
  assertContains(newVideosLoaderSource, "const readActiveScrollMetrics = useCallback((metrics?: ScrollMetrics): ScrollMetrics => {", "New videos loader resolves active overlay/window scroll metrics", failures);
  assertContains(newVideosLoaderSource, "const maybeLoadMoreFromScroll = useCallback(async (metrics?: ScrollMetrics) => {", "New videos loader uses a single scroll-driven load-more function", failures);
  assertContains(newVideosLoaderSource, "const scrollProgress = activeMetrics.scrollTop / maxScrollablePx;", "New videos loader computes scroll progress from active metrics", failures);
  assertContains(newVideosLoaderSource, "if (scrollProgress < NEW_SCROLL_START_RATIO)", "New videos loader waits until halfway scroll progress", failures);
  assertContains(newVideosLoaderSource, "if (now - lastPrefetchAtRef.current < 120) {", "New videos loader rate-limits rapid read-ahead checks", failures);
  assertContains(newVideosLoaderSource, "const remainingScrollablePx = Math.max(", "New videos loader calculates remaining page scroll runway", failures);
  assertContains(newVideosLoaderSource, "if (remainingScrollablePx > NEW_SCROLL_PREFETCH_THRESHOLD_PX)", "New videos loader only fetches near the lower runway", failures);
  assertContains(newVideosLoaderSource, "await loadBatch(nextOffsetRef.current, NEW_SCROLL_BATCH_SIZE);", "New videos loader appends one chunk at a time while scrolling", failures);
  assertContains(newVideosLoaderSource, "const sourceVideos = visibleVideos.slice(0, NEW_PLAYLIST_MAX_ITEMS);", "New videos loader only adds the first 100 New videos when creating a playlist", failures);
  assertContains(newVideosLoaderSource, "window.addEventListener(\"scroll\", onWindowScroll, { passive: true });", "New videos loader prefetches ahead during active scrolling", failures);
  assertContains(newVideosLoaderSource, "overlay.addEventListener(\"scroll\", onOverlayScroll, { passive: true });", "New videos loader prefetches from overlay container scrolling", failures);
  assertNotContains(newVideosLoaderSource, "IntersectionObserver(", "New videos loader does not perform autonomous observer-driven loading", failures);
  assertNotContains(newVideosLoaderSource, "sentinelRef", "New videos loader does not depend on a bottom sentinel for loading", failures);
  assertContains(newVideosLoaderSource, "if (received === 0 && (payload.hasMore === false || emptyBatchStreakRef.current >= 2)) {", "New videos loader only stops after explicit exhaustion or repeated empty batches", failures);
  assertContains(newVideosLoaderSource, "const NewVideoRow = memo(function NewVideoRow", "New videos loader memoizes row wrapper to reduce append-time rerenders", failures);
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
