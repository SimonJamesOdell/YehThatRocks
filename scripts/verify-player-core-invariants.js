#!/usr/bin/env node

// Domain: Player Core
// Covers: player preferences, autoplay/volume/mute/resume, playlist loading,
// end-of-video docked close, now-playing overlay, loading mask, ended-choice overlay,
// unavailable video handling, share modal, admin controls, admin session,
// player hover recovery, same-video replay, share/wiki helpers.

const path = require("node:path");
const {
  readFileStrict,
  collectCssFiles,
  assertContains,
  assertNotContains,
  assertCssRuleContains,
  assertCssRuleNotContains,
  finishInvariantCheck,
} = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  autoplaySettingsEditor: path.join(ROOT, "apps/web/components/autoplay-settings-editor.tsx"),
  accountSettingsPanel: path.join(ROOT, "apps/web/components/account-settings-panel.tsx"),
  useAdminSession: path.join(ROOT, "apps/web/components/use-admin-session.ts"),
  useLyricsAvailability: path.join(ROOT, "apps/web/components/use-lyrics-availability.ts"),
  usePlaylistSequence: path.join(ROOT, "apps/web/components/use-playlist-sequence.ts"),
  useFavouriteState: path.join(ROOT, "apps/web/components/use-favourite-state.ts"),
  useAdminVideoEdit: path.join(ROOT, "apps/web/components/use-admin-video-edit.ts"),
  endedChoiceCard: path.join(ROOT, "apps/web/components/player-experience-ended-choice-card.tsx"),
  autoplayUtils: path.join(ROOT, "apps/web/components/player-experience-autoplay-utils.ts"),
  playbackFailureUtils: path.join(ROOT, "apps/web/components/player-experience-playback-failure-utils.ts"),
  playerPreferencesRoute: path.join(ROOT, "apps/web/app/api/player-preferences/route.ts"),
  videosUnavailableRoute: path.join(ROOT, "apps/web/app/api/videos/unavailable/route.ts"),
  playerPreferenceData: path.join(ROOT, "apps/web/lib/player-preference-data.ts"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  adminVideoDeleteButton: path.join(ROOT, "apps/web/components/admin-video-delete-button.tsx"),
  seenToggleRoute: path.join(ROOT, "apps/web/app/api/seen-toggle-preferences/route.ts"),
  sharePreviewRoute: path.join(ROOT, "apps/web/app/api/videos/share-preview/route.ts"),
  shareHtmlRoute: path.join(ROOT, "apps/web/app/s/[videoId]/route.ts"),
  shareMetadata: path.join(ROOT, "apps/web/lib/share-metadata.ts"),
  chatSharedVideo: path.join(ROOT, "apps/web/lib/chat-shared-video.ts"),
  artistWikiLink: path.join(ROOT, "apps/web/components/artist-wiki-link.tsx"),
  runtimeBootstrap: path.join(ROOT, "apps/web/lib/runtime-bootstrap.ts"),
  appRoot: path.join(ROOT, "apps/web/app"),
};

function main() {
  const failures = [];

  const playerExperienceSource = [
    readFileStrict(files.playerExperience, ROOT),
    readFileStrict(files.autoplaySettingsEditor, ROOT),
    readFileStrict(files.accountSettingsPanel, ROOT),
    readFileStrict(files.useAdminSession, ROOT),
    readFileStrict(files.useLyricsAvailability, ROOT),
    readFileStrict(files.usePlaylistSequence, ROOT),
    readFileStrict(files.useFavouriteState, ROOT),
    readFileStrict(files.useAdminVideoEdit, ROOT),
  ].join("\n");
  const autoplaySettingsEditorSource = readFileStrict(files.autoplaySettingsEditor, ROOT);
  const accountSettingsPanelSource = readFileStrict(files.accountSettingsPanel, ROOT);
  const endedChoiceCardSource = readFileStrict(files.endedChoiceCard, ROOT);
  const autoplayUtilsSource = readFileStrict(files.autoplayUtils, ROOT);
  const playbackFailureUtilsSource = readFileStrict(files.playbackFailureUtils, ROOT);
  const playerPreferencesRouteSource = readFileStrict(files.playerPreferencesRoute, ROOT);
  const videosUnavailableRouteSource = readFileStrict(files.videosUnavailableRoute, ROOT);
  const playerPreferenceDataSource = readFileStrict(files.playerPreferenceData, ROOT);
  const apiSchemasSource = readFileStrict(files.apiSchemas, ROOT);
  const adminVideoDeleteButtonSource = readFileStrict(files.adminVideoDeleteButton, ROOT);
  const seenToggleRouteSource = readFileStrict(files.seenToggleRoute, ROOT);
  const sharePreviewRouteSource = readFileStrict(files.sharePreviewRoute, ROOT);
  const shareHtmlRouteSource = readFileStrict(files.shareHtmlRoute, ROOT);
  const shareMetadataSource = readFileStrict(files.shareMetadata, ROOT);
  const chatSharedVideoSource = readFileStrict(files.chatSharedVideo, ROOT);
  const artistWikiLinkSource = readFileStrict(files.artistWikiLink, ROOT);
  const runtimeBootstrapSource = readFileStrict(files.runtimeBootstrap, ROOT);
  const cssSource = collectCssFiles(files.appRoot)
    .map((filePath) => readFileStrict(filePath, ROOT))
    .join("\n");

  // Player preferences and persistence.
  assertContains(playerExperienceSource, "const AUTOPLAY_KEY = \"yeh-player-autoplay\";", "Player persists autoplay preference key", failures);
  assertContains(playerExperienceSource, "const PLAYER_VOLUME_KEY = \"yeh-player-volume\";", "Player defines persisted volume preference key", failures);
  assertContains(playerExperienceSource, "const PLAYER_MUTED_KEY = \"yeh-player-muted\";", "Player defines persisted mute preference key", failures);
  assertContains(autoplaySettingsEditorSource, 'title = "Sources"', "Autoplay settings editor defaults its header copy to Sources", failures);
  assertContains(autoplaySettingsEditorSource, 'fetchWithAuthRetry("/api/player-preferences", {', "Autoplay settings editor loads persisted player preferences with auth retry", failures);
  assertContains(autoplaySettingsEditorSource, 'fetch("/api/categories", {', "Autoplay settings editor loads available genre options", failures);
  assertContains(autoplaySettingsEditorSource, "setMix((current) => rebalanceAutoplayMix(current, key, value));", "Autoplay settings editor rebalances source percentages when sliders change", failures);
  assertContains(autoplaySettingsEditorSource, "autoplayMix: mix,", "Autoplay settings editor persists autoplay mix selections", failures);
  assertContains(autoplaySettingsEditorSource, "autoplayGenreFilters: limitGenresEnabled ? selectedGenres : [],", "Autoplay settings editor persists autoplay genre filters only when the limiter is enabled", failures);
  assertContains(accountSettingsPanelSource, '<AutoplaySettingsEditor className="accountAutoplayPanel" title="Sources" />', "Account settings exposes the autoplay editor with Sources heading", failures);
  assertContains(playerPreferencesRouteSource, "playerPreferenceMutationSchema.safeParse", "Player preferences API validates mutations with the shared schema", failures);
  assertContains(playerPreferencesRouteSource, "autoplayMix: parsed.data.autoplayMix,", "Player preferences API forwards autoplay mix updates to persistence", failures);
  assertContains(playerPreferencesRouteSource, "autoplayGenreFilters: parsed.data.autoplayGenreFilters,", "Player preferences API forwards autoplay genre filter updates to persistence", failures);
  assertContains(playerPreferenceDataSource, "autoplay_mix_top100 TINYINT UNSIGNED NULL", "Player preference storage persists Top 100 autoplay mix weight", failures);
  assertContains(playerPreferenceDataSource, "autoplay_mix_favourites TINYINT UNSIGNED NULL", "Player preference storage persists favourites autoplay mix weight", failures);
  assertContains(playerPreferenceDataSource, "autoplay_mix_newest TINYINT UNSIGNED NULL", "Player preference storage persists newest autoplay mix weight", failures);
  assertContains(playerPreferenceDataSource, "autoplay_mix_random TINYINT UNSIGNED NULL", "Player preference storage persists random autoplay mix weight", failures);
  assertContains(playerPreferenceDataSource, "autoplay_genre_filters TEXT NULL", "Player preference storage persists autoplay genre filters", failures);
  assertContains(playerPreferenceDataSource, "const autoplayMix = input.autoplayMix ? normalizeAutoplayMix(input.autoplayMix) : null;", "Player preference storage normalizes autoplay mix before writing", failures);
  assertContains(playerPreferenceDataSource, "normalizeAutoplayGenreFilters(input.autoplayGenreFilters)", "Player preference storage normalizes autoplay genre filters before writing", failures);
  assertContains(apiSchemasSource, "autoplayMix: z.object({", "Player preference schema validates autoplay mix payloads", failures);
  assertContains(apiSchemasSource, "autoplayGenreFilters: z.array(z.string().trim().min(1).max(80)).max(24).optional()", "Player preference schema validates autoplay genre filters payloads", failures);
  assertContains(apiSchemasSource, 'message: "autoplayMix percentages must total exactly 100"', "Player preference schema enforces autoplay mix totals", failures);
  assertContains(playerExperienceSource, "temporaryQueue?: VideoRecord[];", "Player props accept temporary queue feed", failures);
  assertContains(playerExperienceSource, "temporaryQueue = [],", "Player defaults temporary queue to an empty list", failures);
  assertContains(playerExperienceSource, "import { EVENT_NAMES, dispatchAppEvent, listenToAppEvent", "Player consumes centralized typed events module", failures);
  assertContains(playerExperienceSource, "const { resolvePlaylistStepTarget, resolveNextTarget, resolvedNextTarget } = useNextTrackDecision({", "Player invokes extracted next-track decision hook", failures);
  assertContains(playerExperienceSource, "const RESUME_KEY = \"yeh-player-resume\";", "Player defines resume snapshot key", failures);
  assertContains(playerExperienceSource, "window.localStorage.setItem(AUTOPLAY_KEY, ", "Player writes autoplay preference to localStorage", failures);
  assertContains(playerExperienceSource, "window.localStorage.setItem(PLAYER_VOLUME_KEY, String(normalizePlayerVolume(volume, 100)));", "Player writes volume preference to localStorage", failures);
  assertContains(playerExperienceSource, "window.localStorage.setItem(PLAYER_MUTED_KEY, String(isMuted));", "Player writes mute preference to localStorage", failures);
  assertContains(playerExperienceSource, "persistMutedPreferenceOnNextSyncRef.current = true;", "Player only persists mute preference when the user explicitly changes mute state", failures);
  assertContains(runtimeBootstrapSource, "export function enableWebShareConsoleWarnFilter", "Runtime bootstrap utility exposes dedicated web-share warning filter helper", failures);
  assertContains(playerExperienceSource, 'import { applyRuntimeBootstrapPatches } from "@/lib/runtime-bootstrap";', "Player imports centralized runtime bootstrap patch helper", failures);
  assertContains(playerExperienceSource, "applyRuntimeBootstrapPatches({ suppressWebShareWarning: true });", "Player explicitly opts into web-share warning suppression", failures);
  assertNotContains(playerExperienceSource, "__ytrWarnPatched", "Player no longer keeps local console.warn patch state flags", failures);
  assertNotContains(playerExperienceSource, "console.warn = (...args: unknown[]) =>", "Player no longer monkey-patches console.warn inline", failures);
  assertContains(playerExperienceSource, "const activePlaylistId = searchParams.get(\"pl\");", "Player reads playlist context from query params", failures);
  assertContains(playerExperienceSource, "const playlistId = activePlaylistId;", "Player snapshots active playlist id before async loading", failures);
  assertContains(playerExperienceSource, "const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {", "Player loads playlist sequence for ordered playback", failures);
  assertContains(playerExperienceSource, "const shouldUseTopFallback =", "Player uses Top 100 fallback when Watch Next pool is small", failures);
  assertContains(playerExperienceSource, "const shouldAutoAdvance =", "Player computes auto-advance using playlist/deep-link/autoplay guard", failures);
  assertContains(playerExperienceSource, "const [showEndedChoiceOverlay, setShowEndedChoiceOverlay] = useState(false);", "Player tracks autoplay-off end chooser overlay state", failures);
  assertContains(playerExperienceSource, "setShowEndedChoiceOverlay(true);", "Player opens chooser overlay when autoplay-off playback ends", failures);
  assertContains(playerExperienceSource, "__ytrInitialPageLoadAutoplaySuppressed?: boolean;", "Player tracks first-load autoplay suppression flag on window runtime", failures);
  assertContains(playerExperienceSource, "__ytrInitialPageLoadVideoId?: string | null;", "Player tracks first-load video id on window runtime", failures);
  assertContains(playerExperienceSource, "if (window.__ytrInitialPageLoadVideoId === undefined)", "Player initializes initial-load video id once per page lifecycle", failures);
  assertContains(playerExperienceSource, "window.__ytrInitialPageLoadVideoId = currentVideoRef.current.id;", "Player snapshots initial page-load video id from current runtime video", failures);
  assertContains(playerExperienceSource, "const shouldSuppress = Boolean(initialPageLoadVideoId && videoId === initialPageLoadVideoId);", "Player suppresses autoplay only for initial page-load video", failures);
  assertContains(playerExperienceSource, "window.__ytrInitialPageLoadAutoplaySuppressed = true;", "Player marks first-load autoplay suppression as handled", failures);
  assertNotContains(playerExperienceSource, "ytr:initial-page-autoplay-suppressed", "Player should not persist first-load suppression in session storage", failures);
  assertContains(playerExperienceSource, "notePlayAttempt();", "Player marks a play attempt before triggering custom playback", failures);
  assertContains(playerExperienceSource, "playerRef.current.playVideo();", "Player custom play path delegates directly to iframe playback", failures);
  assertNotContains(playerExperienceSource, "Some browsers/embeds can remain muted after reload until we explicitly unmute", "Player custom play path should not force an explicit unmute on first play", failures);
  assertNotContains(playerExperienceSource, "if (!hasPlaybackStarted && volume > 0)", "Player custom play path should not special-case first-play unmute", failures);

  // End-of-video docked player close behaviour.
  assertContains(playerExperienceSource, "const [playerClosedByEndOfVideo, setPlayerClosedByEndOfVideo] = useState(false);", "Player tracks end-of-video closure state for docked mode", failures);
  assertContains(playerExperienceSource, "|| playerClosedByEndOfVideo || (showEndedChoiceOverlay && pathname !== \"/\")", "Player suppresses dock surface when closed by EOV or choice overlay is pending on an overlay page", failures);
  assertContains(playerExperienceSource, "// When autoplay is off and player is in docked position, close the player instead of showing overlay", "triggerEndOfVideoAction documents docked close logic", failures);
  assertContains(playerExperienceSource, "setPlayerClosedByEndOfVideo(true);", "triggerEndOfVideoAction silently closes docked player on video end", failures);
  assertContains(playerExperienceSource, "setPlayerClosedByEndOfVideo(false);", "Player resets EOV closure state when a new video is selected", failures);
  assertContains(playerExperienceSource, "setPlayerClosedByEndOfVideo((wasClosed) => {", "Player restores dock and conditionally shows choice overlay when returning to home route", failures);
  assertContains(playerExperienceSource, "if (wasClosed) {", "Player shows choice overlay on home-route restore only if player was previously closed by EOV", failures);

  // Watch history evidence and now-playing overlay.
  assertNotContains(playerExperienceSource, "void reportWatchEvent(1, \"qualified\", 0, 0);", "Player must not record watch history before real playback progress", failures);
  assertContains(playerExperienceSource, "const hasPlaybackEvidence = hasPlaybackStartedRef.current || positionSec > 0 || progressPercent > 0;", "Player records watch history only with real playback evidence", failures);
  assertContains(playerExperienceSource, "const nowPlayingLastVideoIdRef = useRef<string | null>(null);", "Player tracks last now-playing overlay video id for dedupe", failures);
  assertContains(playerExperienceSource, "const nowPlayingLastTriggeredAtRef = useRef<number>(0);", "Player tracks now-playing overlay trigger timestamp for dedupe", failures);
  assertContains(playerExperienceSource, "const duplicateNowPlayingPulse =", "Player computes duplicate now-playing pulse guard", failures);
  assertContains(playerExperienceSource, "(now - nowPlayingLastTriggeredAtRef.current) < 1800", "Player suppresses repeated now-playing pulse within cooldown window", failures);
  assertContains(playerExperienceSource, "const runtimePlayerWithVideoData = playerRef.current as (YouTubePlayer & {", "Player narrows runtime iframe type to optional getVideoData support", failures);
  assertContains(playerExperienceSource, "const runtimeVideoId = runtimePlayerWithVideoData && typeof runtimePlayerWithVideoData.getVideoData === \"function\"", "Player reads runtime iframe video id before acting on PLAYING state", failures);
  assertContains(playerExperienceSource, "if (runtimeVideoId && runtimeVideoId !== activeVideoId) {", "Player ignores stale PLAYING events from replaced video instances", failures);
  assertContains(playerExperienceSource, "logPlayerDebug(\"onStateChange:ignore-stale-playing-event\"", "Player logs stale PLAYING event suppression", failures);
  assertContains(playerExperienceSource, "setShowNowPlayingOverlay(false);", "Player clears now-playing overlay during active video reset", failures);
  assertContains(playerExperienceSource, "window.clearTimeout(overlayTimeoutRef.current);", "Player clears in-flight now-playing timeout before video switch reset", failures);

  // Player loading mask and manual transition.
  assertContains(playerExperienceSource, "const playerFrameClassName = [", "Player derives loading-aware frame class list", failures);
  assertContains(playerExperienceSource, "const [isManualTransitionMaskVisible, setIsManualTransitionMaskVisible] = useState(false);", "Player tracks immediate manual-transition loading mask state", failures);
  assertContains(playerExperienceSource, "function showManualTransitionMask() {", "Player exposes a helper that instantly masks playback during manual skips", failures);
  assertContains(playerExperienceSource, "const showRouteLikeLoadingCopy = isRouteResolving || isManualTransitionMaskVisible;", "Player reuses route-loading copy while manual transition mask is active", failures);
  assertContains(playerExperienceSource, "const showPlayerLoadingOverlay = isLoggedIn && (", "Player loading overlay is suppressed for unauthenticated users (gated on isLoggedIn)", failures);
  assertContains(playerExperienceSource, "isManualTransitionMaskVisible", "Player loading overlay allows manual transition mask to force the loading state", failures);
  assertContains(playerExperienceSource, "showManualTransitionMask();", "Player immediately triggers the loading mask on manual next/previous/hide actions", failures);
  assertContains(playerExperienceSource, 'showPlayerLoadingOverlay ? "playerFrameLoading" : "",', "Player applies playerFrameLoading class while loading overlay is active", failures);
  assertContains(playerExperienceSource, "className={playerFrameClassName}", "Player frame uses computed loading-aware className", failures);
  assertContains(playerExperienceSource, "className=\"playerEndedChoiceOverlay\"", "Player renders chooser overlay container", failures);
  assertContains(playerExperienceSource, "playerEndedChoiceGrid", "Player renders chooser overlay grid", failures);
  assertContains(playerExperienceSource, "playerEndedChoiceGridExiting", "Player defines exit animation for chooser overlay grid reshuffle", failures);

  // Ended-choice overlay invariants.
  assertContains(playerExperienceSource, "const maxEndedChoiceVideos = 12;", "Player caps chooser cards to 12 for larger screens", failures);
  assertContains(playerExperienceSource, "const ENDED_CHOICE_INITIAL_PREFETCH_COUNT = 24;", "Player primes exactly 24 chooser items for first batch", failures);
  assertContains(playerExperienceSource, "const ENDED_CHOICE_BATCH_SIZE = maxEndedChoiceVideos;", "Player keeps incremental chooser fetches aligned to 12-item batches", failures);
  assertContains(playerExperienceSource, "const ENDED_CHOICE_SCROLL_RUNWAY_COUNT = 24;", "Player maintains a 24-item scroll runway for chooser prefetch", failures);
  assertContains(playerExperienceSource, "const ENDED_CHOICE_PREFETCH_BEFORE_END_SECONDS = 3;", "Player prewarms chooser fetches 3 seconds before track end", failures);
  assertContains(playerExperienceSource, "const YOUTUBE_END_SCREEN_COVER_SECONDS = 0;", "Player no longer fades video early to mask YouTube end cards", failures);
  assertNotContains(playerExperienceSource, "const YOUTUBE_END_SCREEN_COVER_SECONDS = 21;", "Player must not restore the old 21-second early fade threshold", failures);
  assertContains(playerExperienceSource, "&& !autoplayEnabledRef.current", "Player only prewarms chooser when autoplay is disabled", failures);
  assertContains(playerExperienceSource, "void fetchEndedChoiceSets(ENDED_CHOICE_INITIAL_PREFETCH_COUNT, {", "Player requests the 24-item chooser prime batch", failures);
  assertContains(playerExperienceSource, "schedulePostPrimeBatch: true,", "Player schedules a one-time post-prime incremental chooser batch", failures);
  assertContains(playerExperienceSource, "params.set(\"hideSeen\", endedChoiceHideSeen ? \"1\" : \"0\");", "Player always sends chooser hide-seen toggle value to server", failures);
  assertContains(playerExperienceSource, "if (currentRunway < ENDED_CHOICE_SCROLL_RUNWAY_COUNT) {", "Player only fetches more chooser items when runway falls below 24", failures);
  assertContains(playerExperienceSource, "void fetchEndedChoiceSets(ENDED_CHOICE_BATCH_SIZE, { background: true });", "Player loads chooser increments in 12-item background batches", failures);
  assertContains(playerExperienceSource, "const [endedChoiceHideSeen, setEndedChoiceHideSeen] = useSeenTogglePreference({", "Player tracks end chooser seen-filter with shared persisted preference hook", failures);
  assertContains(playerExperienceSource, "key: ENDED_CHOICE_HIDE_SEEN_TOGGLE_KEY", "Player stores end chooser seen-filter under dedicated key", failures);
  assertContains(playerExperienceSource, "isAuthenticated: isLoggedIn,", "Player binds seen-toggle persistence to auth state", failures);
  assertContains(playerExperienceSource, "const hasSeenEndedChoiceVideos = isLoggedIn && endedChoiceVideos.some((video) => seenVideoIds?.has(video.id));", "Player detects end chooser seen state only for authenticated users", failures);
  assertContains(playerExperienceSource, "const isSeen = isLoggedIn && (seenVideoIds?.has(video.id) ?? false);", "Player only renders ended-choice seen badges for authenticated users", failures);
  assertContains(playerExperienceSource, "const endedChoiceGridVideos = useMemo(() => {", "Player derives a rendered end-choice grid list from filter state", failures);
  assertContains(playerExperienceSource, 'import { EndedChoiceCard } from "@/components/player-experience-ended-choice-card";', "Player imports extracted ended-choice card module", failures);
  assertContains(endedChoiceCardSource, "export const EndedChoiceCard = memo(function EndedChoiceCard({", "Ended-choice cards are memoized to reduce append-time re-render pressure", failures);
  assertContains(endedChoiceCardSource, "role=\"button\"", "Ended-choice card outer wrapper uses button semantics without nesting a button element", failures);
  assertContains(endedChoiceCardSource, "tabIndex={0}", "Ended-choice card outer wrapper remains keyboard-focusable", failures);
  assertContains(endedChoiceCardSource, "onKeyDown={(event) => {", "Ended-choice card outer wrapper supports keyboard activation", failures);
  assertContains(endedChoiceCardSource, 'import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";', "Ended-choice cards import shared thumbnail pre-flight component", failures);
  assertContains(endedChoiceCardSource, "<YouTubeThumbnailImage", "Ended-choice cards render shared thumbnail pre-flight component", failures);
  assertContains(endedChoiceCardSource, 'hideClosestSelector=".endedChoiceCardSlot"', "Ended-choice cards hide broken thumbnail slots from the chooser grid", failures);
  assertContains(playerExperienceSource, "startTransition(() => {", "Ended-choice remote append updates are scheduled as transitions", failures);
  assertContains(playerExperienceSource, "const endedChoiceRemoteVideosRef = useRef<VideoRecord[]>([]);", "Ended-choice append path tracks remote videos via ref snapshot", failures);
  assertContains(playerExperienceSource, "const endedChoiceRowHeightRef = useRef(220);", "Ended-choice scroll prefetch uses cached row-height measurement", failures);
  assertContains(playerExperienceSource, "const measureEndedChoiceCard = useCallback((node: HTMLDivElement | null) => {", "Ended-choice cards provide a measured row-height callback", failures);
  assertContains(playerExperienceSource, "const rowHeight = Math.max(1, endedChoiceRowHeightRef.current);", "Ended-choice set-index estimation avoids scroll-time DOM queries", failures);
  assertContains(playerExperienceSource, "const endedChoiceNoProgressStreakRef = useRef(0);", "Ended-choice tracks no-progress streak for pagination exhaustion", failures);
  assertContains(playerExperienceSource, "const endedChoiceFailureStreakRef = useRef(0);", "Ended-choice tracks consecutive background fetch failures", failures);
  assertContains(playerExperienceSource, "const endedChoiceAutoRetryBlockedUntilRef = useRef(0);", "Ended-choice throttles aggressive auto-retries with cooldown", failures);
  assertContains(playerExperienceSource, "endedChoiceAutoRetryBlockedUntilRef.current = Date.now() + cappedBackoff;", "Ended-choice applies adaptive retry backoff on repeated failures", failures);
  assertContains(playerExperienceSource, "if (endedChoiceNoProgressStreakRef.current >= 3) {", "Ended-choice stops retry loops after repeated no-progress fetches", failures);
  assertContains(playerExperienceSource, "}, [showEndedChoiceOverlay, currentVideo.id, endedChoiceReshuffleKey]);", "Ended-choice overlay init no longer re-runs on remote list length changes", failures);
  assertNotContains(playerExperienceSource, "showEndedChoiceOverlay, currentVideo.id, endedChoiceRemoteVideos.length, endedChoiceReshuffleKey", "Ended-choice init must not depend on remote list length to avoid reset flicker", failures);
  assertContains(playerExperienceSource, "const fullRowCount = Math.floor(visibleEndedChoiceVideos.length / 4) * 4;", "Player keeps end-choice seen-filter rows as complete multiples of four", failures);
  assertContains(playerExperienceSource, "const needsSeenRowFill =", "Player computes when seen-filtered rows need background refill", failures);
  assertContains(playerExperienceSource, "endedChoiceLoading && endedChoiceGridVideos.length > 0", "Player shows a bottom loading state while additional end-choice rows are fetched", failures);
  assertContains(playerExperienceSource, 'className={`newPageSeenToggle playerEndedChoiceSeenToggle${endedChoiceHideSeen ? " newPageSeenToggleActive" : ""}`}', "Player reuses the New page seen-toggle styling in the end chooser", failures);
  assertContains(playerExperienceSource, 'No unseen choices right now. Try more choices or watch again.', "Player shows an empty state when the chooser is filtered to no unseen videos", failures);
  assertContains(playerExperienceSource, "autoplayEnabledRef.current &&", "Player only auto-advances when autoplay is enabled", failures);
  assertContains(playerExperienceSource, 'const shouldCloseDockedSurface = pathname !== "/";', "Player closes the playback surface instead of opening ended-choice on overlay routes when autoplay is off", failures);
  assertContains(playerExperienceSource, 'if (autoplaySource.type === "new" || autoplaySource.type === "top100") {', "Enabling autoplay on New or Top100 keeps playback local to the open route", failures);
  assertContains(playerExperienceSource, "autoplayRouteTransitionRef.current = false;", "Local route-list autoplay clears transition suspension instead of forcing a route change", failures);

  // Extracted helper-module invariants.
  assertContains(playerExperienceSource, "@/components/player-experience-autoplay-utils", "Player imports extracted route autoplay helpers", failures);
  assertContains(autoplayUtilsSource, "export type RouteAutoplaySource =", "Autoplay utility module exports route source type", failures);
  assertContains(autoplayUtilsSource, "export function resolveRouteAutoplaySource(pathname: string)", "Autoplay utility module exports route source resolver", failures);
  assertContains(autoplayUtilsSource, "export function buildRouteAutoplayPlaylistName", "Autoplay utility module exports playlist name builder", failures);
  assertContains(autoplayUtilsSource, "export function buildRouteAutoplayTelemetryMode", "Autoplay utility module exports telemetry mode helper", failures);

  assertContains(playerExperienceSource, "@/components/player-experience-playback-failure-utils", "Player imports extracted playback-failure helpers", failures);
  assertContains(playbackFailureUtilsSource, "export type ReportUnavailableResult = {", "Playback-failure utility module exports report type", failures);
  assertContains(playbackFailureUtilsSource, "export function isInteractivePlaybackBlockReason", "Playback-failure utility module exports interactive-block classifier", failures);
  assertContains(playbackFailureUtilsSource, "export function isUnavailableVerificationReason", "Playback-failure utility module exports unavailable classifier", failures);
  assertContains(playbackFailureUtilsSource, "export function resolveVerifiedPlaybackFailurePresentation", "Playback-failure utility module exports presentation resolver", failures);

  // Deep-link suppression and unavailable video handling.
  assertContains(playerExperienceSource, "const isInitialDeepLinkedSelection = Boolean(", "Player detects first-load deep-linked selections", failures);
  assertContains(playerExperienceSource, "&& !isInitialDeepLinkedSelection", "Player suppresses autoplay on initial deep-link until user interaction", failures);
  assertContains(playerExperienceSource, "autoAdvanceWhenAutoplay: true", "Player auto-advances unavailable tracks when autoplay is enabled", failures);
  assertContains(playerExperienceSource, "const response = await fetch(\"/api/videos/unavailable\", {", "Player reports unavailable videos to API", failures);
  assertContains(videosUnavailableRouteSource, "const optionalAuth = await getOptionalApiAuth(request);", "Unavailable-video API accepts optional auth for anonymous playback recovery", failures);
  assertContains(playerExperienceSource, "const activeVideoId = currentVideoRef.current.id;", "Player evaluates errors against active runtime video id", failures);
  assertContains(playerExperienceSource, "if (activeVideoId !== currentVideo.id) {", "Player ignores stale unavailable callbacks from replaced instances", failures);
  assertContains(playerExperienceSource, "const playbackAlreadyEstablished =", "Player skips unavailable handling once playback is established", failures);
  assertContains(playerExperienceSource, "setUnavailableOverlayMessage(null);", "Player clears stale unavailable overlay once playback starts", failures);
  assertContains(playerExperienceSource, "setPlayerHostMode(\"youtube\");", "Player retries restricted videos with youtube host fallback", failures);

  // Share modal and footer playlist quick-add.
  assertContains(playerExperienceSource, "const [showShareModal, setShowShareModal] = useState(false);", "Player tracks modal share state", failures);
  assertContains(playerExperienceSource, "setShowShareModal(true);", "Player opens share modal from social share action", failures);
  assertContains(playerExperienceSource, 'className="primaryActionIconButtonWrap primaryActionPlaylistWrap"', "Player renders footer playlist quick-add control", failures);
  assertContains(playerExperienceSource, "const [showFooterPlaylistMenu, setShowFooterPlaylistMenu] = useState(false);", "Player tracks footer playlist menu state", failures);
  assertContains(playerExperienceSource, "if (activePlaylistId) {", "Player adds current track directly when playlist context is active", failures);
  assertContains(playerExperienceSource, "void loadFooterPlaylistMenu();", "Player loads playlist menu options on quick-add open", failures);
  assertContains(playerExperienceSource, "handleFooterCreatePlaylist", "Player supports create-playlist flow from footer menu", failures);
  assertContains(playerExperienceSource, "handleFooterPlaylistSelect", "Player supports selecting an existing playlist from footer menu", failures);

  // Admin docked state and session revalidation.
  assertContains(playerExperienceSource, 'showDockCloseButton && isAdmin ? "primaryActionsDockedAdmin" : "",', "Player applies admin-docked footer class only for docked admin state", failures);
  assertContains(playerExperienceSource, "!(showDockCloseButton && isAdmin) ? (", "Player suppresses inline share field in docked admin state", failures);
  assertContains(playerExperienceSource, "showDockCloseButton && isAdmin ? (", "Player renders dedicated docked admin share row", failures);
  assertContains(playerExperienceSource, "const ADMIN_SESSION_REVALIDATE_INTERVAL_MS = 30_000;", "Player defines a periodic admin-session revalidation cadence", failures);
  assertContains(playerExperienceSource, "const [isAdminSessionActive, setIsAdminSessionActive] = useState(initialIsAdmin);", "Player tracks runtime admin-session capability state", failures);
  assertContains(playerExperienceSource, "return isLoggedIn && isAdminSessionActive;", "Player gates admin controls on active session capability", failures);
  assertContains(playerExperienceSource, "const revalidateAdminSession = useCallback(async () => {", "Player defines shared admin-session revalidation helper", failures);
  assertContains(playerExperienceSource, "await fetchWithAuthRetry(\"/api/admin/dashboard\"", "Player revalidates admin capability against admin API guard", failures);
  assertContains(playerExperienceSource, "window.addEventListener(\"focus\", handleFocus);", "Player revalidates admin capability when tab gains focus", failures);
  assertContains(playerExperienceSource, "document.addEventListener(\"visibilitychange\", handleVisibilityChange);", "Player revalidates admin capability when tab becomes visible", failures);
  assertContains(playerExperienceSource, "window.setInterval(() => {", "Player periodically revalidates admin capability while visible", failures);
  assertContains(playerExperienceSource, "ADMIN_SESSION_REVALIDATE_INTERVAL_MS", "Player uses the admin-session revalidation interval constant", failures);
  assertContains(playerExperienceSource, 'className="shareModalBackdrop"', "Player renders share modal backdrop", failures);
  assertContains(playerExperienceSource, 'buildCanonicalShareUrl(currentVideo.id)', "Player uses canonical short share URLs", failures);
  assertContains(playerExperienceSource, '<ArtistWikiLink', "Player renders artist wiki links in player surfaces", failures);
  assertContains(playerExperienceSource, 'asButton', "Player uses button mode for footer artist wiki control", failures);

  // Admin video title override and delete flow.
  assertContains(playerExperienceSource, "const [localTitleOverride, setLocalTitleOverride] = useState<string | null>(null);", "Player keeps a local title override for immediate admin edit feedback", failures);
  assertContains(playerExperienceSource, "const displayTitle = localTitleOverride ?? currentVideo.title;", "Player uses title override for immediate UI updates", failures);
  assertContains(playerExperienceSource, "setLocalTitleOverride(title);", "Player applies admin title update locally immediately after save", failures);
  assertContains(playerExperienceSource, "const clearedParams = new URLSearchParams(searchParams.toString());", "Admin delete flow derives cleared params from current URL state", failures);
  assertContains(playerExperienceSource, "if (selectedVideoId === deletingVideoId) {", "Admin delete flow only clears query when current selection matches deleted id", failures);
  assertContains(playerExperienceSource, "clearedParams.delete(\"v\");", "Admin delete flow removes deleted video id from URL immediately", failures);
  assertContains(playerExperienceSource, "router.replace(clearedQuery ? `${pathname}?${clearedQuery}` : pathname);", "Admin delete flow updates URL immediately after successful deletion", failures);
  assertContains(playerExperienceSource, "const payload = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null;", "Admin delete flow parses structured API delete failure payload", failures);
  assertContains(playerExperienceSource, "showUnavailableOverlayMessage(payload?.error || \"Could not remove this video from the site.\");", "Admin delete flow surfaces API-provided delete failure error", failures);
  assertContains(playerExperienceSource, 'dispatchAppEvent(EVENT_NAMES.VIDEO_CATALOG_DELETED, { videoId: deletingVideoId })', "Main player delete dispatches catalog-deleted event", failures);
  assertContains(adminVideoDeleteButtonSource, 'dispatchAppEvent(EVENT_NAMES.VIDEO_CATALOG_DELETED, { videoId });', "Admin search-card delete dispatches catalog-deleted event using typed dispatch", failures);

  // Player hover-controls recovery.
  assertContains(playerExperienceSource, "playerFrameRef.current?.matches(\":hover\")", "Player checks real hover state via :hover pseudo-class after pathname change", failures);
  assertContains(playerExperienceSource, "window.setTimeout(() => {", "Player defers hover state check to allow synthetic mouseleave events to fire first", failures);
  assertContains(playerExperienceSource, "return () => window.clearTimeout(id);", "Player cleans up hover-check timeout on effect teardown", failures);

  // Shared-chat same-video replay.
  assertContains(playerExperienceSource, "listenToAppEvent(EVENT_NAMES.REQUEST_VIDEO_REPLAY", "Player defines replay-request event constant", failures);
  assertContains(playerExperienceSource, "listenToAppEvent(EVENT_NAMES.REQUEST_VIDEO_REPLAY, handleReplayRequest);", "Player subscribes to shared replay requests", failures);
  assertContains(playerExperienceSource, "if (!requestedVideoId || requestedVideoId !== currentVideoRef.current.id) {", "Player ignores replay requests for non-current videos", failures);
  assertContains(playerExperienceSource, "if (!showEndedChoiceOverlay) {", "Player only handles same-video replay while ended chooser is visible", failures);
  assertContains(playerExperienceSource, "handleEndedChoiceWatchAgain();", "Player reuses watch-again flow for replay requests", failures);
  assertContains(playerExperienceSource, "if (!playerClosedByEndOfVideo) {", "Player keeps runtime instance alive when surface is closed by end-of-video state", failures);

  // Seen-toggle API for player surfaces (read/write data layer).
  assertContains(seenToggleRouteSource, "getSeenTogglePreferenceForUser", "Seen-toggle API reads persisted values from data layer", failures);
  assertContains(seenToggleRouteSource, "setSeenTogglePreferenceForUser", "Seen-toggle API writes persisted values through data layer", failures);

  // Share and artist wiki helpers.
  assertContains(sharePreviewRouteSource, 'const video = await getVideoForSharing(videoId);', "Share-preview API resolves lightweight share payloads", failures);
  assertContains(sharePreviewRouteSource, 'return NextResponse.json({', "Share-preview API returns JSON payload", failures);
  assertContains(shareHtmlRouteSource, 'const shareMetadata = await resolveShareMetadataForOrigin(rawVideoId, titleHint, siteOrigin);', "Short share route resolves host-aware metadata", failures);
  assertContains(shareHtmlRouteSource, '<meta property="og:title"', "Short share route emits Open Graph metadata", failures);
  assertContains(shareMetadataSource, 'export function buildCanonicalShareUrl(videoId: string, titleHint?: string, origin?: string)', "Share metadata exposes canonical short-link builder", failures);
  assertContains(shareMetadataSource, 'const base = `${siteOrigin}/s/${encodeURIComponent(videoId)}`;', "Canonical share URLs use /s/<videoId>", failures);
  assertContains(chatSharedVideoSource, 'const SHARED_VIDEO_FIELD_SEPARATOR = "\\t";', "Shared chat video payload supports structured fields", failures);
  assertContains(chatSharedVideoSource, 'return {', "Shared chat video parsing returns structured payload object", failures);
  assertContains(artistWikiLinkSource, 'router.push(targetHref);', "Artist wiki link performs client-side navigation", failures);
  assertContains(artistWikiLinkSource, 'dispatchAppEvent(EVENT_NAMES.OVERLAY_OPEN_REQUEST, {', "Artist wiki link triggers typed overlay-open requests", failures);

  // CSS: ended-choice overlay.
  assertContains(cssSource, ".playerEndedChoiceOverlay", "Chooser overlay styles are defined", failures);
  assertContains(cssSource, ".playerEndedChoiceSeenToggle", "Chooser overlay defines a bottom-centered seen toggle style", failures);
  assertContains(cssSource, ".playerEndedChoiceGrid", "Chooser overlay grid styles are defined", failures);
  assertContains(cssSource, ".playerEndedChoiceEmptyState", "Chooser overlay defines an empty state for unseen-only filtering", failures);
  assertContains(cssSource, ".playerEndedChoiceGridExiting", "Chooser overlay grid exit animation is defined", failures);
  assertContains(cssSource, "@media (min-width: 2200px)", "Chooser overlay defines ultrawide breakpoint", failures);
  assertContains(cssSource, "grid-template-columns: repeat(6, minmax(0, 1fr));", "Chooser overlay uses 6 columns on ultrawide for two rows", failures);

  // CSS: favourite badge hover.
  assertContains(cssSource, ".artistVideoFavouriteBadgeButton:hover,", "Favourite badge defines explicit hover state selector", failures);
  assertContains(cssSource, ".artistVideoFavouriteBadgeButton:hover .artistVideoFavouriteBadgeHeart,", "Favourite badge hover keeps heart glyph styling rule", failures);
  assertContains(cssSource, "color: #000;", "Favourite badge hover turns heart glyph black", failures);
  assertContains(cssSource, ".artistVideoFavouriteBadgeButton:hover .artistVideoFavouriteBadgeRemoveGlyph,", "Favourite badge hover reveals remove glyph", failures);
  assertContains(cssSource, "background: transparent;", "Favourite badge hover keeps transparent background without circular fill", failures);
  assertNotContains(cssSource, ".artistVideoFavouriteBadgeButton:hover .artistVideoFavouriteBadgeHeart {\n  transform: translate", "Favourite badge heart must not shift position on hover", failures);

  // CSS: player loading mask.
  assertContains(cssSource, ".playerFrame.playerFrameLoading > iframe,", "Loading mask hides direct iframe while player loader is active", failures);
  assertContains(cssSource, ".playerFrame.playerFrameLoading .playerMount iframe {", "Loading mask hides mounted iframe while player loader is active", failures);
  assertContains(cssSource, "opacity: 0;", "Loading mask applies full iframe opacity suppression", failures);

  // CSS: admin docked footer layout.
  assertContains(cssSource, ".playerChromeDockedDesktop .primaryActions.primaryActionsDockedAdmin,", "CSS defines admin-only docked footer layout mode", failures);
  assertContains(cssSource, "flex-wrap: wrap;", "Admin docked footer layout allows wrapped rows", failures);
  assertContains(cssSource, "overflow: visible;", "Admin docked footer layout keeps secondary share row visible", failures);
  assertContains(cssSource, "align-content: flex-start;", "Admin docked footer layout pins wrapped rows to top", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop .primaryActionsMainRow,", "CSS defines shared docked controls row container", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop .primaryActionsMainRow > *,", "CSS defines stable child sizing for docked controls row", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop .primaryActionsMainRow .shareUrlField,", "CSS keeps share URL field as the flexible slot in docked controls row", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop .primaryActions > .dockedAdminShareUrlRow,", "CSS positions dedicated docked admin share URL row", failures);

  // Footer reflow prevention: fixed-height reserve wrapper and JS height lock.
  assertContains(playerExperienceSource, 'className="playerFooterReserve"', "Player renders footer controls inside a fixed-height reserve wrapper to prevent layout reflow", failures);
  assertContains(playerExperienceSource, '{!suppressUnavailablePlaybackSurface ? (', "Footer controls are conditionally rendered inside the reserve wrapper", failures);

  // Shell: JS height lock during undock-settle to prevent player chrome reflow.
  const shellSource = readFileStrict(path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"), ROOT);
  assertContains(shellSource, "const lockedHeight = chrome.getBoundingClientRect().height;", "Shell measures and locks playerChrome height at start of undock-settle to prevent reflow", failures);
  assertContains(shellSource, "chrome.style.height = `${lockedHeight}px`;", "Shell writes inline height lock on playerChrome before footer re-renders", failures);
  assertContains(shellSource, "chrome.style.height = \"\";", "Shell releases the height lock after footer reveal animation completes", failures);
  assertContains(shellSource, "// Release any height lock so docking can size freely.", "Shell clears height lock when overlay re-opens mid-transition", failures);

  // CSS: playerFooterReserve layout rules.
  assertContains(cssSource, ".playerFooterReserve {", "CSS defines fixed-height footer reserve wrapper", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop .playerFooterReserve", "CSS collapses reserve wrapper height when player is docked", failures);

  // CSS: share modal, playlist menu, wiki links.
  assertContains(cssSource, '.shareModalBackdrop', "Share modal backdrop styles are defined", failures);
  assertContains(cssSource, '.shareModalGrid', "Share modal platform grid styles are defined", failures);
  assertContains(cssSource, '.railTabs.railTabsAdminOverlay', "Admin overlay rail tabs define two-column layout override", failures);
  assertContains(cssSource, '.primaryActionPlaylistMenu', "Footer playlist quick-add menu styles are defined", failures);
  assertContains(cssSource, '.primaryActionPlaylistMenuAction:hover:not(:disabled)', "Footer playlist menu keeps explicit hover accent styles", failures);
  assertContains(cssSource, '.categoryHeaderWikiLink', "Artist wiki header link styles are defined", failures);
  assertContains(cssSource, '.artistInlineLink', "Artist wiki inline link styles are defined", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Player core invariant check failed.",
    successMessage: "Player core invariant check passed.",
  });
}

main();
