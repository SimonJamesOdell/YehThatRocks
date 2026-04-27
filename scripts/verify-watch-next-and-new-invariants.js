#!/usr/bin/env node

// Domain: Watch Next + New
// Covers: Watch Next rail load-more/pagination, startup bootstrap,
// append-only redraw guard, current-video related pool, docked autoplay route-queue,
// Watch Next seen-toggle + hide-confirm, temporary queue, Watch Next CSS.
// New page + loader → verify-new-videos-invariants.js
// Seen-toggle API/data → verify-new-videos-invariants.js

const path = require("node:path");
const { readFileStrict, assertContains, assertNotContains } = require("./invariants/helpers");
const { applyQueueResolutionRulePack } = require("./invariants/rule-packs/queue-resolution-pack");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  shellDynamicRendering: path.join(ROOT, "apps/web/components/shell-dynamic-rendering.tsx"),
  shellDynamicHelpers: path.join(ROOT, "apps/web/components/shell-dynamic-helpers.ts"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  nextTrackDecisionHook: path.join(ROOT, "apps/web/components/use-next-track-decision.ts"),
  temporaryQueueControllerHook: path.join(ROOT, "apps/web/components/use-temporary-queue-controller.ts"),
  playerNextTrackDomain: path.join(ROOT, "apps/web/domains/player/resolve-next-track-target.ts"),
  queueDomain: path.join(ROOT, "apps/web/domains/queue/temporary-queue.ts"),
  playlistDomain: path.join(ROOT, "apps/web/domains/playlist/playlist-step-target.ts"),
  playerEvents: path.join(ROOT, "apps/web/lib/player-events.ts"),
  css: path.join(ROOT, "apps/web/app/globals.css"),
};

function main() {
  const failures = [];

  const shellDynamicSource = readFileStrict(files.shellDynamic, ROOT);
  const shellDynamicRenderingSource = readFileStrict(files.shellDynamicRendering, ROOT);
  const shellDynamicHelpersSource = readFileStrict(files.shellDynamicHelpers, ROOT);
  const currentVideoRouteSource = readFileStrict(files.currentVideoRoute, ROOT);
  const playerExperienceSource = readFileStrict(files.playerExperience, ROOT);
  const nextTrackDecisionHookSource = readFileStrict(files.nextTrackDecisionHook, ROOT);
  const temporaryQueueControllerHookSource = readFileStrict(files.temporaryQueueControllerHook, ROOT);
  const playerNextTrackDomainSource = readFileStrict(files.playerNextTrackDomain, ROOT);
  const queueDomainSource = readFileStrict(files.queueDomain, ROOT);
  const playlistDomainSource = readFileStrict(files.playlistDomain, ROOT);
  const playerEventsSource = readFileStrict(files.playerEvents, ROOT);
  const cssSource = readFileStrict(files.css, ROOT);

  applyQueueResolutionRulePack({
    shellDynamicSource,
    playerExperienceSource,
    temporaryQueueControllerHookSource,
    nextTrackDecisionHookSource,
    playerNextTrackDomainSource,
    queueDomainSource,
    playlistDomainSource,
    playerEventsSource,
    assertContains,
    failures,
  });

  // Watch Next load-more invariants.
  assertContains(shellDynamicSource, "const relatedFetchOffsetRef = useRef<number | null>(null);", "Watch Next tracks a dedicated offset for paged fetches", failures);
  assertContains(shellDynamicSource, "const RELATED_BACKGROUND_PREFETCH_TARGET = 35;", "Watch Next defines a background prefetch target buffer", failures);
  assertContains(shellDynamicSource, "const RELATED_BACKGROUND_PREFETCH_DELAY_MS = 650;", "Watch Next defines a quiet delay before background prefetch", failures);
  assertContains(shellDynamicSource, "const RELATED_BOOTSTRAP_MIN_VISIBLE = 8;", "Watch Next waits for at least 8 videos before first visible rail render", failures);
  assertContains(shellDynamicSource, "const hasUserScrolledWatchNextRef = useRef(false);", "Watch Next tracks whether the user has actively scrolled", failures);
  assertContains(shellDynamicSource, "hasUserScrolledWatchNextRef.current = true;", "Watch Next marks user-driven scroll activity", failures);
  assertContains(shellDynamicSource, "hasUserScrolledWatchNextRef.current = false;", "Watch Next resets user scroll activity when the active video changes", failures);
  assertContains(shellDynamicSource, "|| !hasUserScrolledWatchNextRef.current", "Watch Next blocks background prefetch before user scroll interaction", failures);
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
  assertContains(shellDynamicSource, "aria-label=\"Loading more suggestions\"", "Watch Next load-more hint uses loader bars with an accessible status label", failures);
  assertNotContains(shellDynamicSource, "<p className=\"rightRailStatus\">Loading more suggestions...</p>", "Watch Next no longer shows repetitive loading text between appended batches", failures);
  assertContains(shellDynamicSource, "initialHiddenVideoIds", "Watch Next shell accepts hidden video ids", failures);
  assertContains(shellDynamicSource, "filterHiddenRelatedVideos", "Watch Next shell filters hidden videos from rail", failures);
  assertNotContains(shellDynamicSource, "params.set(\"exclude\"", "Watch Next no longer sends giant exclude id lists in URL", failures);
  assertContains(shellDynamicRenderingSource, "{isSeen && !isFavourite ? <span className=\"videoSeenBadge videoSeenBadgeOverlay relatedSeenBadgeOverlay\">Seen</span> : null}", "Watch Next only renders seen badge when card is seen and not favourited", failures);
  assertContains(shellDynamicRenderingSource, "{isFavourite ? <span className=\"relatedFavouriteBadgeOverlay\" aria-hidden=\"true\">♥</span> : null}", "Watch Next renders favourite heart overlay for favourited cards", failures);
  assertNotContains(shellDynamicSource, "{isSeen ? <span className=\"videoSeenBadge videoSeenBadgeOverlay relatedSeenBadgeOverlay\">Seen</span> : null}", "Watch Next must not render seen badge on favourited cards", failures);

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

  // Temporary queue invariants.
  assertContains(shellDynamicSource, "const {", "Shell destructures temporary queue controller outputs", failures);
  assertContains(shellDynamicSource, "temporaryQueueVideos,", "Shell consumes queue list from extracted hook", failures);
  assertContains(shellDynamicSource, "handleAddToTemporaryQueue,", "Shell consumes queue add handler from extracted hook", failures);
  assertContains(shellDynamicSource, "handleRemoveFromTemporaryQueue,", "Shell consumes queue remove handler from extracted hook", failures);
  assertContains(shellDynamicSource, "handleClearTemporaryQueue,", "Shell consumes queue clear handler from extracted hook", failures);
  assertContains(shellDynamicSource, "temporaryQueueVideoIdSet,", "Shell consumes queue id set from extracted hook", failures);
  assertContains(shellDynamicSource, "Current queue \u2022 {temporaryQueueVideos.length}", "Shell queue rail label uses Current queue copy", failures);
  assertContains(shellDynamicSource, "rightRailMode === \"queue\" ? \"activeTab\" : undefined", "Shell highlights queue tab when selected", failures);
  assertContains(shellDynamicSource, "className={`relatedCard linkedCard relatedCardTransition rightRailPlaylistTrackCard${track.id === currentVideo.id ? \" relatedCardActive\" : \"\"}${clickedRelatedVideoId === track.id ? \" relatedCardClickFlash\" : \"\"}`}", "Queue cards reuse playlist active styling for currently playing item", failures);
  assertContains(shellDynamicSource, "temporaryQueue={temporaryQueueVideos}", "Shell passes temporary queue into player experience", failures);
  assertContains(playerExperienceSource, "import { EVENT_NAMES, dispatchAppEvent, listenToAppEvent", "Player consumes centralized typed events module", failures);
  assertContains(playerExperienceSource, "const { resolvePlaylistStepTarget, resolveNextTarget, resolvedNextTarget } = useNextTrackDecision({", "Player delegates next-target orchestration to extracted hook", failures);
  assertContains(playerExperienceSource, "const currentVideoWasQueued = temporaryQueue.some((video) => video.id === currentVideo.id);", "Player detects when current video belongs to temporary queue", failures);

  // Watch Next redraw-loop regression invariants.
  assertContains(shellDynamicSource, "const currentIds = displayedRelatedVideos.map((video) => video.id);", "Watch Next transition effect snapshots currently displayed ids", failures);
  assertContains(shellDynamicSource, "const nextIds = sourceRelatedVideos.map((video) => video.id);", "Watch Next transition effect snapshots incoming ids", failures);
  // Append-only detection is in the shared helpers module (shell-dynamic-helpers.ts).
  assertContains(shellDynamicHelpersSource, "currentIds.length > 0", "Watch Next detects append-only rail growth", failures);
  assertContains(shellDynamicHelpersSource, "currentIds.every((id, index) => nextIds[index] === id)", "Watch Next verifies append-only prefix alignment", failures);
  assertContains(shellDynamicSource, "const isAppendOnlyUpdate = detectAppendOnly(currentIds, nextIds);", "Watch Next uses extracted detectAppendOnly helper for append-only check", failures);
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
  assertContains(currentVideoRouteSource, '? Math.max(48, requestedRelatedOffset + requestedRelatedCount + 24)', "Current-video route uses bounded ended-choice pool sizing instead of 1000+ overfetch", failures);
  assertContains(currentVideoRouteSource, "const preferUnseenForEndedChoice = requestMode === \"ended-choice\" && hideSeenOnly && Boolean(optionalAuth?.userId);", "Current-video route derives ended-choice unseen preference from hideSeen toggle", failures);
  assertContains(currentVideoRouteSource, "const seenVideoIds = await getSeenVideoIdsForUser(optionalAuth.userId);", "Current-video route fetches seen ids for ended-choice hide-seen requests", failures);
  assertContains(currentVideoRouteSource, "filteredPool = filteredPool.filter((video) => !seenVideoIds.has(video.id));", "Current-video route enforces server-side displayable unseen filtering for ended-choice batches", failures);
  assertContains(currentVideoRouteSource, "getTopVideos(300)", "Current-video route widens fallback with Top candidates", failures);
  assertContains(currentVideoRouteSource, "getNewestVideos(200, 0)", "Current-video route widens fallback with New candidates", failures);
  assertContains(currentVideoRouteSource, "getUnseenCatalogVideos({", "Current-video route widens fallback with unseen catalog candidates", failures);
  assertContains(currentVideoRouteSource, "return [...deduped, ...merged].slice(0, CURRENT_VIDEO_RELATED_POOL_SIZE);", "Current-video route enforces bounded merged pool size", failures);

  // Docked autoplay route-queue invariants.
  assertContains(playerExperienceSource, "const [routeAutoplayQueueIds, setRouteAutoplayQueueIds] = useState<string[]>([]);", "Player tracks route-scoped autoplay queue ids", failures);
  assertContains(playerExperienceSource, "if (!isDockedDesktop || !autoplayEnabled || Boolean(activePlaylistId))", "Route autoplay queue activates only while docked autoplay is enabled and no playlist is active", failures);
  assertContains(playerExperienceSource, "const onNewRoute = pathname === \"/new\";", "Docked autoplay recognizes New page list route", failures);
  assertContains(playerExperienceSource, "const onTop100Route = pathname === \"/top100\";", "Docked autoplay recognizes Top100 list route", failures);
  assertContains(playerExperienceSource, "const onFavouritesRoute = pathname === \"/favourites\";", "Docked autoplay recognizes Favourites list route", failures);
  assertContains(playerExperienceSource, "const onCategoryRoute = pathname.startsWith(\"/categories/\");", "Docked autoplay recognizes Category detail list route", failures);
  assertContains(playerExperienceSource, "const onArtistRoute = pathname.startsWith(\"/artist/\");", "Docked autoplay recognizes Artist detail list route", failures);
  assertContains(playerNextTrackDomainSource, "if (isDockedDesktop && autoplayEnabled && routeAutoplayQueueIds.length > 0)", "Autoplay next target prioritizes route queue when docked on list pages", failures);
  assertContains(playerNextTrackDomainSource, "const currentIndex = routeAutoplayQueueIds.findIndex((videoId) => videoId === currentVideoId);", "Route queue next selection is based on current video position", failures);
  assertContains(playerNextTrackDomainSource, "const nextIndex = currentIndex >= 0", "Route queue next selection advances in list order", failures);
  assertContains(playerNextTrackDomainSource, "const randomWatchNextId = getRandomWatchNextId();", "Random watch-next fallback still exists when no route queue target is available", failures);

  // Watch Next seen-toggle and hide-confirm (shell surface).
  assertContains(shellDynamicSource, "useSeenTogglePreference", "Watch Next shell uses shared seen-toggle persistence hook", failures);
  assertContains(shellDynamicSource, "key: WATCH_NEXT_HIDE_SEEN_TOGGLE_KEY", "Watch Next shell stores preference under Watch Next key", failures);
  assertContains(shellDynamicSource, "const [watchNextHideConfirmTrack, setWatchNextHideConfirmTrack] = useState<VideoRecord | null>(null);", "Watch Next shell tracks hide-confirm modal target video", failures);
  assertContains(shellDynamicSource, "<HideVideoConfirmModal", "Watch Next shell renders hide-confirm modal", failures);
  assertContains(shellDynamicSource, "void confirmHideFromWatchNext();", "Watch Next shell confirms exclusion via shared modal callback", failures);

  // Watch Next card title clamp invariants.
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
