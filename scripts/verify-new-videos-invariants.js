#!/usr/bin/env node

// Domain: New Videos
// Covers: New page non-blocking staged loading, new-videos-loader pagination/scroll,
// Top 100 hide-confirm, ended-choice hide-confirm, shared hide-confirm modal,
// seen-toggle persistence (hook, API, data layer), data-model (schema) invariants.

const path = require("node:path");
const { readFileStrict, assertContains, assertNotContains } = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  newPage: path.join(ROOT, "apps/web/app/(shell)/new/page.tsx"),
  newLoading: path.join(ROOT, "apps/web/app/(shell)/new/loading.tsx"),
  newVideosLoader: path.join(ROOT, "apps/web/components/new-videos-loader.tsx"),
  top100VideosLoader: path.join(ROOT, "apps/web/components/top100-videos-loader.tsx"),
  newestRoute: path.join(ROOT, "apps/web/app/api/videos/newest/route.ts"),
  hideVideoConfirmModal: path.join(ROOT, "apps/web/components/hide-video-confirm-modal.tsx"),
  seenToggleHook: path.join(ROOT, "apps/web/components/use-seen-toggle-preference.ts"),
  seenToggleRoute: path.join(ROOT, "apps/web/app/api/seen-toggle-preferences/route.ts"),
  seenToggleData: path.join(ROOT, "apps/web/lib/seen-toggle-preference-data.ts"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  schema: path.join(ROOT, "prisma/schema.prisma"),
};

function main() {
  const failures = [];

  const playerExperienceSource = readFileStrict(files.playerExperience, ROOT);
  const newPageSource = readFileStrict(files.newPage, ROOT);
  const newLoadingSource = readFileStrict(files.newLoading, ROOT);
  const newVideosLoaderSource = readFileStrict(files.newVideosLoader, ROOT);
  const top100VideosLoaderSource = readFileStrict(files.top100VideosLoader, ROOT);
  const newestRouteSource = readFileStrict(files.newestRoute, ROOT);
  const hideVideoConfirmModalSource = readFileStrict(files.hideVideoConfirmModal, ROOT);
  const seenToggleHookSource = readFileStrict(files.seenToggleHook, ROOT);
  const seenToggleRouteSource = readFileStrict(files.seenToggleRoute, ROOT);
  const seenToggleDataSource = readFileStrict(files.seenToggleData, ROOT);
  const apiSchemasSource = readFileStrict(files.apiSchemas, ROOT);
  const schemaSource = readFileStrict(files.schema, ROOT);

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
  assertContains(newestRouteSource, "const probedVideos = await getNewestVideos(probeTake, skip, {", "Newest API probes one extra row to calculate hasMore", failures);
  assertContains(newestRouteSource, "enforcePlaybackAvailability: true,", "Newest API enforces playback availability", failures);
  assertContains(newestRouteSource, "const hasMore = probedVideos.length > take;", "Newest API derives hasMore from probed count", failures);
  assertContains(newestRouteSource, "const nextOffset = skip + videos.length;", "Newest API returns nextOffset derived from emitted rows", failures);
  assertContains(newestRouteSource, "nextOffset,", "Newest API response includes nextOffset", failures);
  assertContains(newVideosLoaderSource, "nextOffsetRef.current = Number.isFinite(nextOffset) ? nextOffset : skip + received;", "New videos loader advances offset using API-provided nextOffset when available", failures);

  // New videos loader constants and state.
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

  // New videos loader catalog-deleted event handling.
  assertContains(newVideosLoaderSource, 'window.addEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);', "New videos loader subscribes to catalog-deleted event for live removals", failures);
  assertContains(newVideosLoaderSource, 'return () => window.removeEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);', "New videos loader unsubscribes from catalog-deleted event", failures);
  assertContains(newVideosLoaderSource, "allVideoIdsRef.current.delete(deletedId);", "New videos loader updates id index after catalog-deleted event", failures);

  // Seen-toggle persistence for New and Top 100 surfaces.
  assertContains(newVideosLoaderSource, "useSeenTogglePreference", "New videos loader uses shared seen-toggle persistence hook", failures);
  assertContains(newVideosLoaderSource, "key: NEW_HIDE_SEEN_TOGGLE_KEY", "New videos loader stores preference under New-specific key", failures);
  assertContains(newVideosLoaderSource, "isAuthenticated,", "New videos loader passes auth state into seen-toggle hook", failures);
  assertContains(top100VideosLoaderSource, "useSeenTogglePreference", "Top 100 loader uses shared seen-toggle persistence hook", failures);
  assertContains(top100VideosLoaderSource, "key: TOP100_HIDE_SEEN_TOGGLE_KEY", "Top 100 loader stores preference under Top 100 key", failures);

  // Hide-confirm modal integration for New and Top 100.
  assertContains(newVideosLoaderSource, "const [videoPendingHideConfirm, setVideoPendingHideConfirm] = useState<VideoRecord | null>(null);", "New videos loader tracks hide-confirm modal target video", failures);
  assertContains(newVideosLoaderSource, "setVideoPendingHideConfirm(track);", "New videos loader opens hide-confirm modal from card actions", failures);
  assertContains(newVideosLoaderSource, "<HideVideoConfirmModal", "New videos loader renders hide-confirm modal", failures);
  assertContains(newVideosLoaderSource, "void confirmHideVideo();", "New videos loader confirms exclusion via shared modal callback", failures);
  assertContains(top100VideosLoaderSource, "const [videoPendingHideConfirm, setVideoPendingHideConfirm] = useState<VideoRecord | null>(null);", "Top 100 loader tracks hide-confirm modal target video", failures);
  assertContains(top100VideosLoaderSource, "setVideoPendingHideConfirm(track);", "Top 100 loader opens hide-confirm modal from card actions", failures);
  assertContains(top100VideosLoaderSource, "<HideVideoConfirmModal", "Top 100 loader renders hide-confirm modal", failures);
  assertContains(top100VideosLoaderSource, "void confirmHideVideo();", "Top 100 loader confirms exclusion via shared modal callback", failures);

  // Hide-confirm modal integration for ended-choice overlay.
  assertContains(playerExperienceSource, "const [endedChoiceHideConfirmVideo, setEndedChoiceHideConfirmVideo] = useState<VideoRecord | null>(null);", "Ended-choice overlay tracks hide-confirm modal target video", failures);
  assertContains(playerExperienceSource, "<HideVideoConfirmModal", "Ended-choice overlay renders hide-confirm modal", failures);
  assertContains(playerExperienceSource, "onConfirm={confirmEndedChoiceHide}", "Ended-choice overlay confirms exclusion via shared modal callback", failures);

  // Shared hide-confirm modal copy and style invariants.
  assertContains(hideVideoConfirmModalSource, "Will be added to blocked videos", "Hide-confirm modal keeps blocked-videos eyebrow copy", failures);
  assertContains(hideVideoConfirmModalSource, "Confirm exclusion", "Hide-confirm modal keeps confirm exclusion action label", failures);
  assertContains(hideVideoConfirmModalSource, "hideVideoConfirmBackdrop", "Hide-confirm modal uses dedicated backdrop class", failures);
  assertContains(hideVideoConfirmModalSource, "hideVideoConfirmModal", "Hide-confirm modal uses dedicated modal class", failures);

  // Seen-toggle hook and API.
  assertContains(seenToggleHookSource, 'fetch(`/api/seen-toggle-preferences?key=${encodeURIComponent(key)}`', "Seen-toggle hook fetches authenticated preference values from API", failures);
  assertContains(seenToggleHookSource, "void fetch(\"/api/seen-toggle-preferences\"", "Seen-toggle hook posts updated preference values to API", failures);
  assertContains(seenToggleRouteSource, "requireApiAuth", "Seen-toggle preference API requires authentication", failures);
  assertContains(seenToggleRouteSource, "verifySameOrigin", "Seen-toggle preference API enforces same-origin checks for mutations", failures);
  assertContains(seenToggleRouteSource, "seenTogglePreferenceMutationSchema.safeParse", "Seen-toggle preference API validates mutation payloads", failures);
  assertContains(seenToggleDataSource, "CREATE TABLE IF NOT EXISTS user_seen_toggle_preferences", "Seen-toggle preference data layer bootstraps persistence table", failures);
  assertContains(seenToggleDataSource, "ON DUPLICATE KEY UPDATE", "Seen-toggle preference writes are upserted per user/key", failures);
  assertContains(apiSchemasSource, "seenTogglePreferenceKeySchema", "API schemas define a dedicated seen-toggle key schema", failures);

  // Data-model invariants for New ordering and rejected table support.
  assertContains(schemaSource, "@@index([createdAt(sort: Desc), id(sort: Desc)], map: \"idx_videos_created_at_id\")", "Schema keeps deterministic videos created_at/id index for New ordering", failures);
  assertContains(schemaSource, "model RejectedVideo {", "Schema defines rejected video blocklist table", failures);
  assertContains(schemaSource, "@@map(\"rejected_videos\")", "Rejected video model maps to rejected_videos table", failures);

  if (failures.length > 0) {
    console.error("New videos invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("New videos invariant check passed.");
}

main();
