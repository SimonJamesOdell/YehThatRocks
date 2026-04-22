#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic.tsx"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience.tsx"),
  chatRoute: path.join(ROOT, "apps/web/app/api/chat/route.ts"),
  chatStreamRoute: path.join(ROOT, "apps/web/app/api/chat/stream/route.ts"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  sharePreviewRoute: path.join(ROOT, "apps/web/app/api/videos/share-preview/route.ts"),
  shareHtmlRoute: path.join(ROOT, "apps/web/app/s/[videoId]/route.ts"),
  shareMetadata: path.join(ROOT, "apps/web/lib/share-metadata.ts"),
  chatSharedVideo: path.join(ROOT, "apps/web/lib/chat-shared-video.ts"),
  artistWikiLink: path.join(ROOT, "apps/web/components/artist-wiki-link.tsx"),
  seenToggleRoute: path.join(ROOT, "apps/web/app/api/seen-toggle-preferences/route.ts"),
  statusPerformanceRoute: path.join(ROOT, "apps/web/app/api/status/performance/route.ts"),
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
  const playerExperienceSource = read(files.playerExperience);
  const chatRouteSource = read(files.chatRoute);
  const chatStreamRouteSource = read(files.chatStreamRoute);
  const currentVideoRouteSource = read(files.currentVideoRoute);
  const sharePreviewRouteSource = read(files.sharePreviewRoute);
  const shareHtmlRouteSource = read(files.shareHtmlRoute);
  const shareMetadataSource = read(files.shareMetadata);
  const chatSharedVideoSource = read(files.chatSharedVideo);
  const artistWikiLinkSource = read(files.artistWikiLink);
  const seenToggleRouteSource = read(files.seenToggleRoute);
  const statusPerformanceRouteSource = read(files.statusPerformanceRoute);
  const cssSource = read(files.css);

  // Watch Next and current-video resolver invariants.
  assertContains(shellDynamicSource, "<div className=\"railTabs rightRailTabs\">", "Shell renders right rail tabs container", failures);
  assertContains(shellDynamicSource, "Watch Next", "Shell labels a right rail tab as Watch Next", failures);
  assertContains(shellDynamicSource, "Playlist", "Shell labels a right rail tab as Playlist", failures);
  assertContains(shellDynamicSource, "const [relatedTransitionPhase, setRelatedTransitionPhase] = useState<\"idle\" | \"fading-out\" | \"loading\" | \"fading-in\">(\"idle\");", "Watch Next uses explicit transition phases", failures);
  assertContains(shellDynamicSource, "seenVideoIdsRef.current = new Set<string>();", "Shell clears stale seen ids when auth is lost", failures);
  assertContains(shellDynamicSource, "if (!isAuthenticated) {", "Shell ignores watch-history seen updates while logged out", failures);
  assertContains(shellDynamicSource, "isSeen={isAuthenticated && seenVideoIdsRef.current.has(track.id)}", "Shell only renders watch-next seen badges for authenticated users", failures);
  assertContains(shellDynamicSource, "watchNextRailRef.current.scrollTop = 0;", "Watch Next resets scroll top during transition", failures);
  assertContains(currentVideoRouteSource, "const targetRelatedCount = 10;", "Current-video API targets 10 Watch Next items", failures);
  assertContains(currentVideoRouteSource, "const topVideos = await getTopVideos(30);", "Current-video API fetches bounded filler pool", failures);
  assertContains(currentVideoRouteSource, "const filler = shuffleVideos(fillerPool).slice(0, targetRelatedCount - relatedVideos.length);", "Current-video API randomizes sparse filler selection", failures);

  // Player invariants.
  assertContains(playerExperienceSource, "const AUTOPLAY_KEY = \"yeh-player-autoplay\";", "Player persists autoplay preference key", failures);
  assertContains(playerExperienceSource, "const PLAYER_VOLUME_KEY = \"yeh-player-volume\";", "Player defines persisted volume preference key", failures);
  assertContains(playerExperienceSource, "const PLAYER_MUTED_KEY = \"yeh-player-muted\";", "Player defines persisted mute preference key", failures);
  assertContains(playerExperienceSource, "const RESUME_KEY = \"yeh-player-resume\";", "Player defines resume snapshot key", failures);
  assertContains(playerExperienceSource, "window.localStorage.setItem(AUTOPLAY_KEY, ", "Player writes autoplay preference to localStorage", failures);
  assertContains(playerExperienceSource, "window.localStorage.setItem(PLAYER_VOLUME_KEY, String(normalizePlayerVolume(volume, 100)));", "Player writes volume preference to localStorage", failures);
  assertContains(playerExperienceSource, "window.localStorage.setItem(PLAYER_MUTED_KEY, String(isMuted));", "Player writes mute preference to localStorage", failures);
  assertContains(playerExperienceSource, "persistMutedPreferenceOnNextSyncRef.current = true;", "Player only persists mute preference when the user explicitly changes mute state", failures);
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

  // End-of-video docked player close behaviour invariants.
  // When autoplay is off and the video ends in the docked position the player
  // should silently close rather than show the choice overlay over the dock.
  // When the user returns to "/" the player is restored and the choice overlay
  // is shown. While an overlay page is open the dock must remain hidden.
  assertContains(playerExperienceSource, "const [playerClosedByEndOfVideo, setPlayerClosedByEndOfVideo] = useState(false);", "Player tracks end-of-video closure state for docked mode", failures);
  assertContains(playerExperienceSource, "|| playerClosedByEndOfVideo || (showEndedChoiceOverlay && pathname !== \"/\")", "Player suppresses dock surface when closed by EOV or choice overlay is pending on an overlay page", failures);
  assertContains(playerExperienceSource, "// When autoplay is off and player is in docked position, close the player instead of showing overlay", "triggerEndOfVideoAction documents docked close logic", failures);
  assertContains(playerExperienceSource, "setPlayerClosedByEndOfVideo(true);", "triggerEndOfVideoAction silently closes docked player on video end", failures);
  assertContains(playerExperienceSource, "setPlayerClosedByEndOfVideo(false);", "Player resets EOV closure state when a new video is selected", failures);
  assertContains(playerExperienceSource, "setPlayerClosedByEndOfVideo((wasClosed) => {", "Player restores dock and conditionally shows choice overlay when returning to home route", failures);
  assertContains(playerExperienceSource, "if (wasClosed) {", "Player shows choice overlay on home-route restore only if player was previously closed by EOV", failures);
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
  assertContains(playerExperienceSource, "const playerFrameClassName = [", "Player derives loading-aware frame class list", failures);
  assertContains(playerExperienceSource, 'showPlayerLoadingOverlay ? "playerFrameLoading" : "",', "Player applies playerFrameLoading class while loading overlay is active", failures);
  assertContains(playerExperienceSource, "className={playerFrameClassName}", "Player frame uses computed loading-aware className", failures);
  assertContains(playerExperienceSource, "className=\"playerEndedChoiceOverlay\"", "Player renders chooser overlay container", failures);
  assertContains(playerExperienceSource, "playerEndedChoiceGrid", "Player renders chooser overlay grid", failures);
  assertContains(playerExperienceSource, "playerEndedChoiceGridExiting", "Player defines exit animation for chooser overlay grid reshuffle", failures);
  assertContains(playerExperienceSource, "const maxEndedChoiceVideos = 12;", "Player caps chooser cards to 12 for larger screens", failures);
  assertContains(playerExperienceSource, "const [endedChoiceHideSeen, setEndedChoiceHideSeen] = useSeenTogglePreference({", "Player tracks end chooser seen-filter with shared persisted preference hook", failures);
  assertContains(playerExperienceSource, "key: ENDED_CHOICE_HIDE_SEEN_TOGGLE_KEY", "Player stores end chooser seen-filter under dedicated key", failures);
  assertContains(playerExperienceSource, "isAuthenticated: isLoggedIn,", "Player binds seen-toggle persistence to auth state", failures);
  assertContains(playerExperienceSource, "const hasSeenEndedChoiceVideos = isLoggedIn && endedChoiceVideos.some((video) => seenVideoIds?.has(video.id));", "Player detects end chooser seen state only for authenticated users", failures);
  assertContains(playerExperienceSource, "const isSeen = isLoggedIn && (seenVideoIds?.has(video.id) ?? false);", "Player only renders ended-choice seen badges for authenticated users", failures);
  assertContains(playerExperienceSource, "const endedChoiceGridVideos = useMemo(() => {", "Player derives a rendered end-choice grid list from filter state", failures);
  assertContains(playerExperienceSource, "const EndedChoiceCard = memo(function EndedChoiceCard({", "Ended-choice cards are memoized to reduce append-time re-render pressure", failures);
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
  assertContains(cssSource, ".playerEndedChoiceOverlay", "Chooser overlay styles are defined", failures);
  assertContains(cssSource, ".playerEndedChoiceSeenToggle", "Chooser overlay defines a bottom-centered seen toggle style", failures);
  assertContains(cssSource, ".playerEndedChoiceGrid", "Chooser overlay grid styles are defined", failures);
  assertContains(cssSource, ".playerEndedChoiceEmptyState", "Chooser overlay defines an empty state for unseen-only filtering", failures);
  assertContains(cssSource, ".playerEndedChoiceGridExiting", "Chooser overlay grid exit animation is defined", failures);
  assertContains(cssSource, "@media (min-width: 2200px)", "Chooser overlay defines ultrawide breakpoint", failures);
  assertContains(cssSource, "grid-template-columns: repeat(6, minmax(0, 1fr));", "Chooser overlay uses 6 columns on ultrawide for two rows", failures);
  assertContains(playerExperienceSource, "const isInitialDeepLinkedSelection = Boolean(", "Player detects first-load deep-linked selections", failures);
  assertContains(playerExperienceSource, "&& !isInitialDeepLinkedSelection", "Player suppresses autoplay on initial deep-link until user interaction", failures);
  assertContains(playerExperienceSource, "showUnavailableOverlayMessage();", "Player shows unavailable apology overlay when runtime checks fail", failures);
  assertContains(playerExperienceSource, "const response = await fetch(\"/api/videos/unavailable\", {", "Player reports unavailable videos to API", failures);
  assertContains(playerExperienceSource, "const activeVideoId = currentVideoRef.current.id;", "Player evaluates errors against active runtime video id", failures);
  assertContains(playerExperienceSource, "if (activeVideoId !== currentVideo.id) {", "Player ignores stale unavailable callbacks from replaced instances", failures);
  assertContains(playerExperienceSource, "const playbackAlreadyEstablished =", "Player skips unavailable handling once playback is established", failures);
  assertContains(playerExperienceSource, "setUnavailableOverlayMessage(null);", "Player clears stale unavailable overlay once playback starts", failures);
  assertContains(playerExperienceSource, "setPlayerHostMode(\"youtube\");", "Player retries restricted videos with youtube host fallback", failures);
  assertContains(playerExperienceSource, "const [showShareModal, setShowShareModal] = useState(false);", "Player tracks modal share state", failures);
  assertContains(playerExperienceSource, "setShowShareModal(true);", "Player opens share modal from social share action", failures);
  assertContains(playerExperienceSource, 'className="primaryActionIconButtonWrap primaryActionPlaylistWrap"', "Player renders footer playlist quick-add control", failures);
  assertContains(playerExperienceSource, "const [showFooterPlaylistMenu, setShowFooterPlaylistMenu] = useState(false);", "Player tracks footer playlist menu state", failures);
  assertContains(playerExperienceSource, "if (activePlaylistId) {", "Player adds current track directly when playlist context is active", failures);
  assertContains(playerExperienceSource, "void loadFooterPlaylistMenu();", "Player loads playlist menu options on quick-add open", failures);
  assertContains(playerExperienceSource, "handleFooterCreatePlaylist", "Player supports create-playlist flow from footer menu", failures);
  assertContains(playerExperienceSource, "handleFooterPlaylistSelect", "Player supports selecting an existing playlist from footer menu", failures);
  assertContains(playerExperienceSource, 'className="shareModalBackdrop"', "Player renders share modal backdrop", failures);
  assertContains(playerExperienceSource, 'buildCanonicalShareUrl(currentVideo.id)', "Player uses canonical short share URLs", failures);
  assertContains(playerExperienceSource, '<ArtistWikiLink', "Player renders artist wiki links in player surfaces", failures);
  assertContains(playerExperienceSource, 'asButton', "Player uses button mode for footer artist wiki control", failures);
  assertContains(playerExperienceSource, "const [localTitleOverride, setLocalTitleOverride] = useState<string | null>(null);", "Player keeps a local title override for immediate admin edit feedback", failures);
  assertContains(playerExperienceSource, "const displayTitle = localTitleOverride ?? currentVideo.title;", "Player uses title override for immediate UI updates", failures);
  assertContains(playerExperienceSource, "setLocalTitleOverride(adminEditTitle);", "Player applies admin title update locally immediately after save", failures);

  // Dock-hide interaction invariants.
  assertContains(playerExperienceSource, 'window.dispatchEvent(new CustomEvent("ytr:dock-hide-request"));', "Dock close control dispatches hide-only event instead of navigating away", failures);
  assertContains(shellDynamicSource, "const handleDockHideRequest = () => {", "Shell defines a dock-hide event handler", failures);
  assertContains(shellDynamicSource, "setIsDockHidden(true);", "Shell hides docked player in response to dock-hide event", failures);
  assertContains(shellDynamicSource, 'window.addEventListener("ytr:dock-hide-request", handleDockHideRequest);', "Shell subscribes to dock-hide requests", failures);
  assertContains(shellDynamicSource, 'window.removeEventListener("ytr:dock-hide-request", handleDockHideRequest);', "Shell cleans up dock-hide listener", failures);
  assertContains(shellDynamicSource, '<div className="playerDockLayer">', "Shell keeps player content in a dedicated dock layer", failures);
  assertContains(shellDynamicSource, "const UNDOCK_SETTLE_DURATION_MS = 220;", "Shell defines an undock-settle duration", failures);
  assertContains(shellDynamicSource, "const [isUndockSettling, setIsUndockSettling] = useState(false);", "Shell tracks undock settle state", failures);
  assertContains(shellDynamicSource, 'isUndockSettling ? "playerChromeUndockSettling" : "",', "Shell applies undock-settle class to player chrome", failures);
  assertContains(cssSource, ".playerDockLayer", "CSS defines dedicated dock layer sizing", failures);
  assertContains(cssSource, ".playerChromeDockedHidden .playerDockLayer", "Dock-hide class only hides player layer, not overlay page", failures);
  assertContains(cssSource, ".overlayIconBtn.overlayDockCloseBtn", "Dock close button keeps explicit red styling with high specificity", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .overlayCenter,", "Undocking keeps overlay center pinned to avoid play-button reflow", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndockSettling .overlayCenter {", "Undock settling keeps overlay center pinned", failures);
  assertContains(cssSource, ".playerOverlayVisible .overlayCenter {", "Overlay center visible-state rules are explicitly defined", failures);
  assertContains(cssSource, "pointer-events: auto;", "Overlay controls remain interactive in CSS", failures);
  assertContains(cssSource, ".playerFrame.playerFrameLoading > iframe,", "Loading mask hides direct iframe while player loader is active", failures);
  assertContains(cssSource, ".playerFrame.playerFrameLoading .playerMount iframe {", "Loading mask hides mounted iframe while player loader is active", failures);
  assertContains(cssSource, "opacity: 0;", "Loading mask applies full iframe opacity suppression", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop:not(.playerChromeUndocking):not(.playerChromeUndockSettling) .overlayVolumeSlider {", "Docked-only volume scaling is scoped away from undock/settle states", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop:not(.playerChromeUndocking):not(.playerChromeUndockSettling) .overlayProgress {", "Docked-only scrub scaling is scoped away from undock/settle states", failures);
  assertContains(cssSource, "transition: width 520ms cubic-bezier(0.2, 0.92, 0.34, 1), height 520ms cubic-bezier(0.2, 0.92, 0.34, 1);", "Overlay controls animate size transitions during undock", failures);
  assertContains(cssSource, "gap 520ms cubic-bezier(0.2, 0.92, 0.34, 1),", "Overlay bottom animates gap to final geometry", failures);
  assertContains(cssSource, "padding 520ms cubic-bezier(0.2, 0.92, 0.34, 1);", "Overlay bottom animates padding to final geometry", failures);

  // Public performance modal invariants.
  assertContains(shellDynamicSource, 'className="performanceQuickLaunch"', "Shell renders top-right performance launcher button", failures);
  assertContains(shellDynamicSource, 'aria-label="Open server performance metrics"', "Performance launcher includes accessible label", failures);
  assertContains(shellDynamicSource, 'const [isPerformanceQuickLaunchVisible, setIsPerformanceQuickLaunchVisible] = useState(false);', "Shell tracks deferred visibility for the performance launcher", failures);
  assertContains(shellDynamicSource, 'const isShellInitialUiSettled =', "Shell derives a settled-initial-UI gate before showing the performance launcher", failures);
  assertContains(shellDynamicSource, 'if (isShellInitialUiSettled) {', "Shell waits for initial UI settling before showing the performance launcher", failures);
  assertContains(shellDynamicSource, 'setIsPerformanceQuickLaunchVisible(true);', "Shell reveals the performance launcher only after initial UI settles", failures);
  assertContains(shellDynamicSource, 'const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState(false);', "Shell tracks performance modal open state", failures);
  assertContains(shellDynamicSource, 'const PUBLIC_PERFORMANCE_POLL_MS = 2_500;', "Shell defines periodic polling interval for performance modal", failures);
  assertContains(shellDynamicSource, 'await fetch("/api/status/performance"', "Shell loads metrics from public performance status endpoint", failures);
  assertContains(shellDynamicSource, 'className="performanceModalOverlay"', "Shell renders performance modal backdrop overlay", failures);
  assertContains(shellDynamicSource, 'className="performanceModalDialog"', "Shell renders performance modal dialog container", failures);
  assertContains(shellDynamicSource, 'aria-labelledby="performance-modal-title"', "Performance modal exposes labelled dialog semantics", failures);
  assertContains(shellDynamicSource, '{isPerformanceQuickLaunchVisible ? (', "Shell conditionally renders the performance launcher only when its deferred gate is open", failures);
  assertContains(shellDynamicSource, '<PerformanceDial label="Memory"', "Performance modal renders memory dial", failures);
  assertContains(shellDynamicSource, 'label="CPU"', "Performance modal renders CPU dial", failures);
  assertContains(shellDynamicSource, '<PerformanceDial label="Disk"', "Performance modal renders disk dial", failures);
  assertContains(shellDynamicSource, '<PerformanceDial label="Network"', "Performance modal renders network dial", failures);
  assertContains(cssSource, ".performanceQuickLaunch", "CSS defines top-right performance launcher styles", failures);
  assertContains(cssSource, ".performanceModalOverlay", "CSS defines darkened/blurred performance modal backdrop", failures);
  assertContains(cssSource, "backdrop-filter: blur(8px) saturate(0.82);", "Performance modal backdrop keeps blur treatment", failures);
  assertContains(cssSource, ".performanceModalDialog", "CSS defines centered performance modal dialog styles", failures);
  assertContains(cssSource, ".performanceDialGrid", "CSS defines dial grid layout for performance modal", failures);

  // Public status performance API invariants.
  assertContains(statusPerformanceRouteSource, 'import { buildAdminHealthPayload } from "@/lib/admin-dashboard-health";', "Public performance API reuses host metric builder", failures);
  assertContains(statusPerformanceRouteSource, "const payload = await buildAdminHealthPayload();", "Public performance API builds fresh health payload", failures);
  assertContains(statusPerformanceRouteSource, "host: {", "Public performance API returns host metrics payload", failures);
  assertContains(statusPerformanceRouteSource, "cpuUsagePercent: payload.health.host.cpuUsagePercent", "Public performance API exposes CPU dial metric", failures);
  assertContains(statusPerformanceRouteSource, "memoryUsagePercent: payload.health.host.memoryUsagePercent", "Public performance API exposes memory dial metric", failures);
  assertContains(statusPerformanceRouteSource, "networkUsagePercent: payload.health.host.networkUsagePercent", "Public performance API exposes network dial metric", failures);
  assertContains(statusPerformanceRouteSource, '"Cache-Control": "no-store, no-cache, must-revalidate"', "Public performance API disables cache for live metrics", failures);
  assertNotContains(statusPerformanceRouteSource, "requireAdminApiAuth", "Public performance API is intentionally not admin-gated", failures);
  assertNotContains(statusPerformanceRouteSource, "requireApiAuth", "Public performance API is intentionally accessible without auth", failures);

  // API invariants for shared seen-toggle persistence used by player surfaces.
  assertContains(seenToggleRouteSource, "requireApiAuth", "Seen-toggle API requires auth before reading persisted player preferences", failures);
  assertContains(seenToggleRouteSource, "verifySameOrigin", "Seen-toggle API protects mutations with same-origin checks", failures);
  assertContains(seenToggleRouteSource, "getSeenTogglePreferenceForUser", "Seen-toggle API reads persisted values from data layer", failures);
  assertContains(seenToggleRouteSource, "setSeenTogglePreferenceForUser", "Seen-toggle API writes persisted values through data layer", failures);

  // Dock sizing hot-reload invariant.
  assertContains(shellDynamicSource, "const frame = chrome.querySelector(\".playerFrame, .playerLoadingFallback\") as HTMLElement | null;", "Shell computes dock sizing using either player frame or loading fallback", failures);

  // Player hover-controls recovery invariants.
  assertContains(playerExperienceSource, "playerFrameRef.current?.matches(\":hover\")", "Player checks real hover state via :hover pseudo-class after pathname change", failures);
  assertContains(playerExperienceSource, "window.setTimeout(() => {", "Player defers hover state check to allow synthetic mouseleave events to fire first", failures);
  assertContains(playerExperienceSource, "return () => window.clearTimeout(id);", "Player cleans up hover-check timeout on effect teardown", failures);

  // Denied deep-link loop guard invariants.
  assertContains(shellDynamicSource, "const deniedRequestedVideoIdRef = useRef<string | null>(null);", "Shell tracks denied requested video ids", failures);
  assertContains(shellDynamicSource, "if (deniedRequestedVideoIdRef.current === requestedVideoId) {", "Shell skips repeated denied requested video resolution", failures);
  assertContains(shellDynamicSource, "if (requestedVideoId === lastVideoIdRef.current && isResolvingRequestedVideo) {", "Shell avoids duplicate in-flight resolve loops for same requested id", failures);
  assertNotContains(shellDynamicSource, "params.delete(\"v\");", "Shell no longer mutates URL to clear denied video id", failures);
  assertNotContains(shellDynamicSource, "params.delete(\"resume\");", "Shell no longer removes resume marker on denied id", failures);

  // Chat UI invariants.
  assertContains(shellDynamicSource, "const globalEvents = new EventSource(\"/api/chat/stream?mode=global\");", "Shell subscribes to global chat stream", failures);
  assertContains(shellDynamicSource, "const videoEvents = new EventSource(`/api/chat/stream?mode=video&videoId=${encodeURIComponent(currentVideo.id)}`);", "Shell subscribes to video chat stream", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(`/api/chat?${params.toString()}`);", "Shell loads chat via authenticated API call", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(\"/api/chat\", {", "Shell posts chat messages via authenticated API call", failures);
  assertContains(shellDynamicSource, "videoId: chatMode === \"video\" ? currentVideo.id : undefined,", "Shell sends video chat context when posting", failures);
  assertContains(shellDynamicSource, 'className={isAdminOverlayRoute ? "railTabs railTabsAdminOverlay" : "railTabs"}', "Shell uses dedicated admin overlay rail tab layout class", failures);
  assertContains(shellDynamicSource, "onClick={() => setChatMode(\"online\")}", "Shell keeps Who's Online tab selectable in chat rail", failures);
  assertNotContains(shellDynamicSource, '<span className="tabLabel activeTab">Global Chat</span>', "Shell no longer hard-locks admin rail to a non-interactive Global Chat label", failures);
  assertContains(shellDynamicSource, "node.scrollTop = node.scrollHeight;", "Shell auto-scrolls chat list to latest message", failures);
  assertContains(shellDynamicSource, 'fetch(`/api/videos/share-preview?v=${encodeURIComponent(videoId)}`)', "Shared chat cards resolve preview metadata via share-preview API", failures);
  assertContains(shellDynamicSource, "const REQUEST_VIDEO_REPLAY_EVENT = \"ytr:request-video-replay\";", "Shell defines replay-request event constant for shared chat cards", failures);
  assertContains(shellDynamicSource, "window.dispatchEvent(new CustomEvent(REQUEST_VIDEO_REPLAY_EVENT, {", "Shell dispatches replay request when shared chat card is clicked", failures);
  assertContains(shellDynamicSource, 'const routeLoadingLabel = pathname.endsWith("/wiki") || pendingOverlayOpenKind === "wiki" ? "Loading wiki" : "Loading video";', "Shell loading fallback derives wiki-aware copy including optimistic wiki opens", failures);
  assertContains(shellDynamicSource, 'const OVERLAY_OPEN_REQUEST_EVENT = "ytr:overlay-open-request";', "Shell defines an optimistic overlay-open request event constant", failures);
  assertContains(shellDynamicSource, 'window.addEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);', "Shell listens for optimistic overlay-open requests", failures);

  // Shared-chat same-video replay invariants.
  assertContains(playerExperienceSource, "const REQUEST_VIDEO_REPLAY_EVENT = \"ytr:request-video-replay\";", "Player defines replay-request event constant", failures);
  assertContains(playerExperienceSource, "window.addEventListener(REQUEST_VIDEO_REPLAY_EVENT, handleReplayRequest);", "Player subscribes to shared replay requests", failures);
  assertContains(playerExperienceSource, "if (!requestedVideoId || requestedVideoId !== currentVideoRef.current.id) {", "Player ignores replay requests for non-current videos", failures);
  assertContains(playerExperienceSource, "if (!showEndedChoiceOverlay) {", "Player only handles same-video replay while ended chooser is visible", failures);
  assertContains(playerExperienceSource, "handleEndedChoiceWatchAgain();", "Player reuses watch-again flow for replay requests", failures);
  assertContains(playerExperienceSource, "if (!playerClosedByEndOfVideo) {", "Player keeps runtime instance alive when surface is closed by end-of-video state", failures);

  // Chat API invariants.
  assertContains(chatRouteSource, "const authResult = await requireApiAuth(request);", "Chat REST API requires authenticated session", failures);
  assertContains(chatRouteSource, "mode: z.enum([\"global\", \"video\", \"online\"]).default(\"global\"),", "Chat GET schema validates supported chat modes", failures);
  assertContains(chatRouteSource, "mode: z.enum([\"global\", \"video\"]),", "Chat POST schema restricts writable modes", failures);
  assertContains(chatRouteSource, "content: z.string().trim().min(1).max(200),", "Chat POST enforces message length limits", failures);
  assertContains(chatRouteSource, "chatEvents.emit(chatChannel(mode, mode === \"video\" ? (videoId ?? null) : null), mapped);", "Chat POST emits events to room channel", failures);
  assertContains(chatRouteSource, "return NextResponse.json({ ok: true, message: mapped }, { status: 201 });", "Chat POST returns created message payload", failures);

  // Chat stream API invariants.
  assertContains(chatStreamRouteSource, "const authResult = await requireApiAuth(request);", "Chat stream API requires authenticated session", failures);
  assertContains(chatStreamRouteSource, "const stream = new ReadableStream({", "Chat stream API uses SSE readable stream", failures);
  assertContains(chatStreamRouteSource, "controller.enqueue(encoder.encode(\": heartbeat\\n\\n\"));", "Chat stream API emits heartbeat comments", failures);
  assertContains(chatStreamRouteSource, "\"Content-Type\": \"text/event-stream\"", "Chat stream API sets SSE content type", failures);

  // Share and artist wiki helper invariants.
  assertContains(sharePreviewRouteSource, 'const video = await getVideoForSharing(videoId);', "Share-preview API resolves lightweight share payloads", failures);
  assertContains(sharePreviewRouteSource, 'return NextResponse.json({', "Share-preview API returns JSON payload", failures);
  assertContains(shareHtmlRouteSource, 'const shareMetadata = await resolveShareMetadataForOrigin(rawVideoId, titleHint, siteOrigin);', "Short share route resolves host-aware metadata", failures);
  assertContains(shareHtmlRouteSource, '<meta property="og:title"', "Short share route emits Open Graph metadata", failures);
  assertContains(shareMetadataSource, 'export function buildCanonicalShareUrl(videoId: string, titleHint?: string, origin?: string)', "Share metadata exposes canonical short-link builder", failures);
  assertContains(shareMetadataSource, 'const base = `${siteOrigin}/s/${encodeURIComponent(videoId)}`;', "Canonical share URLs use /s/<videoId>", failures);
  assertContains(chatSharedVideoSource, 'const SHARED_VIDEO_FIELD_SEPARATOR = "\\t";', "Shared chat video payload supports structured fields", failures);
  assertContains(chatSharedVideoSource, 'return {', "Shared chat video parsing returns structured payload object", failures);
  assertContains(artistWikiLinkSource, 'router.push(targetHref);', "Artist wiki link performs client-side navigation", failures);
  assertContains(artistWikiLinkSource, 'window.dispatchEvent(new CustomEvent("ytr:overlay-open-request", {', "Artist wiki link triggers immediate overlay-open requests", failures);
  assertContains(cssSource, '.shareModalBackdrop', "Share modal backdrop styles are defined", failures);
  assertContains(cssSource, '.shareModalGrid', "Share modal platform grid styles are defined", failures);
  assertContains(cssSource, '.railTabs.railTabsAdminOverlay', "Admin overlay rail tabs define two-column layout override", failures);
  assertContains(cssSource, '.primaryActionPlaylistMenu', "Footer playlist quick-add menu styles are defined", failures);
  assertContains(cssSource, '.primaryActionPlaylistMenuAction:hover:not(:disabled)', "Footer playlist menu keeps explicit hover accent styles", failures);
  assertContains(cssSource, '.categoryHeaderWikiLink', "Artist wiki header link styles are defined", failures);
  assertContains(cssSource, '.artistInlineLink', "Artist wiki inline link styles are defined", failures);

  if (failures.length > 0) {
    console.error("Core experience invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Core experience invariant check passed.");
}

main();
