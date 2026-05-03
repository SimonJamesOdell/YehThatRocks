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
  newVideosLoader: path.join(ROOT, "apps/web/components/new-videos-loader.tsx"),
  newVideosDataLoaderHook: path.join(ROOT, "apps/web/components/use-new-videos-data-loader.ts"),
  activeRowAutoScrollHook: path.join(ROOT, "apps/web/components/use-active-row-auto-scroll.ts"),
  newVideosScrollPrefetchHook: path.join(ROOT, "apps/web/components/use-new-videos-scroll-prefetch.ts"),
  newVideosModerationHook: path.join(ROOT, "apps/web/components/use-new-videos-moderation.ts"),
  suggestNewModal: path.join(ROOT, "apps/web/components/suggest-new-modal.tsx"),
  suggestNewHook: path.join(ROOT, "apps/web/components/use-suggest-new-video.ts"),
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
  const newVideosLoaderSource = readFileStrict(files.newVideosLoader, ROOT);
  const newVideosDataLoaderHookSource = readFileStrict(files.newVideosDataLoaderHook, ROOT);
  const activeRowAutoScrollHookSource = readFileStrict(files.activeRowAutoScrollHook, ROOT);
  const newVideosScrollPrefetchHookSource = readFileStrict(files.newVideosScrollPrefetchHook, ROOT);
  const newVideosModerationHookSource = readFileStrict(files.newVideosModerationHook, ROOT);
  const suggestNewModalSource = readFileStrict(files.suggestNewModal, ROOT);
  const suggestNewHookSource = readFileStrict(files.suggestNewHook, ROOT);
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
  assertContains(newVideosLoaderSource, 'loadingLabel="Loading new videos..."', "New route exposes a dedicated loading state", failures);
  assertContains(newVideosDataLoaderHookSource, "fetch(`/api/videos/newest?skip=${skip}&take=${take}`", "New videos data hook uses offset/take pagination for batch fetches", failures);
  assertContains(newVideosDataLoaderHookSource, "const payload = (await response.json()) as NewVideosApiPayload;", "New videos data hook parses newest API pagination metadata", failures);
  assertContains(newestRouteSource, "const probedVideos = await getNewestVideos(probeTake, skip, {", "Newest API probes one extra row to calculate hasMore", failures);
  assertContains(newestRouteSource, "enforcePlaybackAvailability: true,", "Newest API enforces playback availability", failures);
  assertContains(newestRouteSource, "const hasMore = probedVideos.length > take;", "Newest API derives hasMore from probed count", failures);
  assertContains(newestRouteSource, "const nextOffset = skip + videos.length;", "Newest API returns nextOffset derived from emitted rows", failures);
  assertContains(newestRouteSource, "nextOffset,", "Newest API response includes nextOffset", failures);
  assertContains(newVideosDataLoaderHookSource, "nextOffsetRef.current = Number.isFinite(nextOffset) ? nextOffset : skip + received;", "New videos data hook advances offset using API-provided nextOffset when available", failures);

  // New videos loader constants and state.
  assertContains(newVideosLoaderSource, "const NEW_INITIAL_BATCH_SIZE = 12;", "New videos loader uses smaller initial lazy-load batches", failures);
  assertContains(newVideosLoaderSource, "const NEW_STARTUP_PREFETCH_TARGET = 100;", "New videos loader preloads a 100-video startup runway", failures);
  assertContains(newVideosLoaderSource, "const NEW_PLAYLIST_MAX_ITEMS = 100;", "New videos loader caps New-playlist creation to 100 items", failures);
  assertContains(newVideosLoaderSource, "const NEW_SCROLL_BATCH_SIZE = 10;", "New videos loader uses small incremental batches while scrolling", failures);
  assertContains(newVideosLoaderSource, "const NEW_SCROLL_PREFETCH_THRESHOLD_PX = 1400;", "New videos loader keeps a modest runway ahead near the bottom", failures);
  assertContains(newVideosLoaderSource, "const NEW_SCROLL_START_RATIO = 0.5;", "New videos loader starts additional loading around halfway through scrolling", failures);
  assertContains(newVideosDataLoaderHookSource, "const initialResult = await loadBatch(0, initialBatchSize, { initial: true });", "New videos data hook performs fast bootstrap with the small initial batch size", failures);
  assertContains(newVideosDataLoaderHookSource, "while (nextOffsetRef.current < startupPrefetchTarget && hasMoreRef.current)", "New videos data hook incrementally warms startup buffer via repeated small fetches", failures);
  assertContains(newVideosDataLoaderHookSource, "const [isLoadingMore, setIsLoadingMore] = useState(false);", "New videos data hook tracks incremental infinite-scroll loading state", failures);
  assertContains(newVideosDataLoaderHookSource, "const [hasMore, setHasMore] = useState(true);", "New videos data hook tracks pagination exhaustion", failures);
  assertContains(newVideosDataLoaderHookSource, "const emptyBatchStreakRef = useRef(0);", "New videos data hook tracks consecutive empty pages before stopping", failures);
  assertContains(newVideosDataLoaderHookSource, "const hasMoreRef = useRef(true);", "New videos data hook mirrors hasMore in a ref for stable observer callbacks", failures);
  assertContains(newVideosDataLoaderHookSource, "const isLoadingMoreRef = useRef(false);", "New videos data hook mirrors incremental loading in a ref for stable observer callbacks", failures);
  assertContains(newVideosDataLoaderHookSource, "const prefetchInFlightRef = useRef(false);", "New videos data hook prevents overlapping ahead-prefetch loops", failures);
  assertContains(newVideosDataLoaderHookSource, "const lastPrefetchAtRef = useRef(0);", "New videos data hook throttles viewport-driven prefetch checks", failures);
  assertContains(newVideosLoaderSource, 'import { useNewVideosDataLoader } from "@/components/use-new-videos-data-loader";', "New videos loader imports data-loading hook", failures);
  assertContains(newVideosLoaderSource, "} = useNewVideosDataLoader({", "New videos loader delegates bootstrap and head-refresh behavior to data-loading hook", failures);
  assertContains(newVideosLoaderSource, 'import { useNewVideosScrollPrefetch } from "@/components/use-new-videos-scroll-prefetch";', "New videos loader imports scroll prefetch hook", failures);
  assertContains(newVideosLoaderSource, "useNewVideosScrollPrefetch({", "New videos loader delegates scroll prefetch/read-ahead behavior to hook", failures);
  assertContains(newVideosScrollPrefetchHookSource, "type ScrollMetrics = {", "New videos scroll prefetch hook tracks scroll metrics from the active scroll container", failures);
  assertContains(newVideosScrollPrefetchHookSource, "const readActiveScrollMetrics = useCallback((metrics?: ScrollMetrics): ScrollMetrics => {", "New videos scroll prefetch hook resolves active overlay/window scroll metrics", failures);
  assertContains(newVideosScrollPrefetchHookSource, "const maybeLoadMoreFromScroll = useCallback(async (metrics?: ScrollMetrics) => {", "New videos scroll prefetch hook uses a single scroll-driven load-more function", failures);
  assertContains(newVideosScrollPrefetchHookSource, "const scrollProgress = activeMetrics.scrollTop / maxScrollablePx;", "New videos scroll prefetch hook computes scroll progress from active metrics", failures);
  assertContains(newVideosScrollPrefetchHookSource, "if (scrollProgress < scrollStartRatio)", "New videos scroll prefetch hook waits until halfway scroll progress threshold", failures);
  assertContains(newVideosScrollPrefetchHookSource, "if (now - lastPrefetchAtRef.current < 120) {", "New videos scroll prefetch hook rate-limits rapid read-ahead checks", failures);
  assertContains(newVideosScrollPrefetchHookSource, "const remainingScrollablePx = Math.max(", "New videos scroll prefetch hook calculates remaining page scroll runway", failures);
  assertContains(newVideosScrollPrefetchHookSource, "if (remainingScrollablePx > scrollPrefetchThresholdPx)", "New videos scroll prefetch hook only fetches near the lower runway", failures);
  assertContains(newVideosScrollPrefetchHookSource, "await loadBatch(nextOffsetRef.current, scrollBatchSize);", "New videos scroll prefetch hook appends one chunk at a time while scrolling", failures);
  assertContains(newVideosLoaderSource, "const sourceVideos = visibleVideos.slice(0, NEW_PLAYLIST_MAX_ITEMS);", "New videos loader only adds the first 100 New videos when creating a playlist", failures);
  assertContains(newVideosLoaderSource, 'import { createPlaylistFromVideoList } from "@/lib/playlist-create-from-video-list";', "New videos loader imports shared createPlaylistFromVideoList helper", failures);
  assertContains(newVideosLoaderSource, "await createPlaylistFromVideoList({", "New videos loader delegates playlist creation flow to shared helper", failures);
  assertNotContains(newVideosLoaderSource, "await createPlaylistClient(", "New videos loader does not duplicate low-level playlist creation orchestration", failures);
  assertNotContains(newVideosLoaderSource, "addPlaylistItemsClient(", "New videos loader does not duplicate low-level add-items orchestration", failures);
  assertContains(newVideosScrollPrefetchHookSource, "window.addEventListener(\"scroll\", onWindowScroll, { passive: true });", "New videos scroll prefetch hook prefetches ahead during active scrolling", failures);
  assertContains(newVideosScrollPrefetchHookSource, "overlay.addEventListener(\"scroll\", onOverlayScroll, { passive: true });", "New videos scroll prefetch hook prefetches from overlay container scrolling", failures);
  assertNotContains(newVideosLoaderSource, "IntersectionObserver(", "New videos loader does not perform autonomous observer-driven loading", failures);
  assertNotContains(newVideosLoaderSource, "sentinelRef", "New videos loader does not depend on a bottom sentinel for loading", failures);
  assertContains(newVideosDataLoaderHookSource, "if (received === 0 && (payload.hasMore === false || emptyBatchStreakRef.current >= 2)) {", "New videos data hook only stops after explicit exhaustion or repeated empty batches", failures);
  assertContains(newVideosLoaderSource, "const NewVideoRow = memo(function NewVideoRow", "New videos loader memoizes row wrapper to reduce append-time rerenders", failures);
  assertContains(newVideosDataLoaderHookSource, "filterHiddenVideos", "New videos data hook filters hidden videos", failures);
  assertNotContains(newVideosLoaderSource, "sortVideosBySeen(", "New videos loader does not reorder rows by seen state", failures);
  assertNotContains(newVideosLoaderSource, "/api/watch-history", "New videos loader does not pad with watch-history rows", failures);

  // New videos moderation domain split invariants.
  assertContains(newVideosLoaderSource, 'import { useNewVideosModeration } from "@/components/use-new-videos-moderation";', "New videos loader imports moderation hook", failures);
  assertContains(newVideosLoaderSource, "} = useNewVideosModeration({", "New videos loader delegates hide/flag mutation orchestration to moderation hook", failures);
  assertContains(newVideosModerationHookSource, "export function useNewVideosModeration", "New videos moderation hook exports explicit hide/flag domain behavior", failures);
  assertContains(newVideosModerationHookSource, 'import { mutateHiddenVideo } from "@/lib/hidden-video-client-service";', "New videos moderation hook uses shared hidden-video mutation service", failures);
  assertContains(newVideosModerationHookSource, "fetch(\"/api/videos/flags\", {", "New videos moderation hook owns flag mutation API orchestration", failures);
  assertContains(newVideosModerationHookSource, "onRemoveVideoById(flaggingVideo.id);", "New videos moderation hook removes rows through explicit boundary callback", failures);

  // Active-row auto-scroll domain split invariants.
  assertContains(newVideosLoaderSource, 'import { useActiveRowAutoScroll } from "@/components/use-active-row-auto-scroll";', "New videos loader imports active-row auto-scroll hook", failures);
  assertContains(newVideosLoaderSource, "useActiveRowAutoScroll({", "New videos loader delegates active-row auto-scroll behavior to hook", failures);
  assertContains(activeRowAutoScrollHookSource, "export function useActiveRowAutoScroll", "Active-row auto-scroll hook exports explicit domain behavior", failures);
  assertContains(activeRowAutoScrollHookSource, "document.querySelector<HTMLElement>(\".trackCard.top100CardActive\")", "Active-row auto-scroll hook resolves active row anchor from track card selector", failures);
  assertContains(activeRowAutoScrollHookSource, "window.requestAnimationFrame", "Active-row auto-scroll hook drives smooth scrolling via requestAnimationFrame", failures);

  // Suggest New domain split invariants.
  assertContains(newVideosLoaderSource, 'import { SuggestNewModal } from "@/components/suggest-new-modal";', "New videos loader imports Suggest New presentational modal", failures);
  assertContains(newVideosLoaderSource, 'import { useSuggestNewVideo } from "@/components/use-suggest-new-video";', "New videos loader imports Suggest New domain hook", failures);
  assertContains(newVideosLoaderSource, "const {", "New videos loader destructures hook return for Suggest New state/actions", failures);
  assertContains(newVideosLoaderSource, "} = useSuggestNewVideo({", "New videos loader delegates Suggest New state machine to hook", failures);
  assertContains(newVideosLoaderSource, "<SuggestNewModal", "New videos loader renders Suggest New via dedicated modal component", failures);
  assertContains(suggestNewHookSource, "export function useSuggestNewVideo", "Suggest New hook exports explicit domain state machine", failures);
  assertContains(suggestNewHookSource, "fetch(\"/api/videos/suggest\", {", "Suggest New hook owns suggest API orchestration", failures);
  assertContains(suggestNewModalSource, "export function SuggestNewModal", "Suggest New modal exports presentational component", failures);
  assertContains(suggestNewModalSource, "createPortal(", "Suggest New modal owns portal rendering details", failures);

  // New videos loader catalog-deleted event handling.
  assertContains(newVideosLoaderSource, 'window.addEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);', "New videos loader subscribes to catalog-deleted event for live removals", failures);
  assertContains(newVideosLoaderSource, 'return () => window.removeEventListener("ytr:video-catalog-deleted", handleCatalogDeleted);', "New videos loader unsubscribes from catalog-deleted event", failures);
  assertContains(newVideosLoaderSource, "removeVideoById(deletedId);", "New videos loader delegates catalog-deleted removals to data-loading hook boundary", failures);
  assertContains(newVideosDataLoaderHookSource, "allVideoIdsRef.current.delete(videoId);", "New videos data hook updates id index when removing a video", failures);

  // Seen-toggle persistence for New and Top 100 surfaces.
  assertContains(newVideosLoaderSource, "useSeenTogglePreference", "New videos loader uses shared seen-toggle persistence hook", failures);
  assertContains(newVideosLoaderSource, "key: NEW_HIDE_SEEN_TOGGLE_KEY", "New videos loader stores preference under New-specific key", failures);
  assertContains(newVideosLoaderSource, "isAuthenticated,", "New videos loader passes auth state into seen-toggle hook", failures);
  assertContains(top100VideosLoaderSource, "useSeenTogglePreference", "Top 100 loader uses shared seen-toggle persistence hook", failures);
  assertContains(top100VideosLoaderSource, "key: TOP100_HIDE_SEEN_TOGGLE_KEY", "Top 100 loader stores preference under Top 100 key", failures);

  // Hide-confirm modal integration for New and Top 100.
  assertContains(newVideosLoaderSource, "videoPendingHideConfirm", "New videos loader tracks hide-confirm modal target video through moderation hook state", failures);
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

  // Active row button positioning fix: the glow animation rule must not override absolute-position buttons.
  const cssSource = [
    readFileStrict(path.join(ROOT, "apps/web/app/globals.css"), ROOT),
    readFileStrict(path.join(ROOT, "apps/web/app/styles/track-cards.css"), ROOT),
  ].join("\n");
  assertContains(cssSource, ".trackCard.leaderboardCard.top100CardActive > .top100CardAction,", "Active row action buttons restore absolute positioning over the > * glow rule", failures);
  assertContains(cssSource, ".trackCard.leaderboardCard.top100CardActive > .top100CardFlagButton {", "Active row flag button has position:absolute override for glow state", failures);
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
