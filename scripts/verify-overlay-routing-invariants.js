#!/usr/bin/env node

// Domain: Overlay Routing
// Covers: dock-hide interaction, dock CSS / undocking animation, performance modal,
// performance API, denied deep-link loop guard, chat UI, chat API, categories
// open/loading/reveal contract.

const path = require("node:path");
const {
  mapRelativeFiles,
  loadSourceMap,
  joinFileSources,
  loadCssSourceFromRoots,
  assertContains,
  assertNotContains,
  assertCssRuleContains,
  assertCssRuleNotContains,
  assertFileDoesNotExist,
  finishInvariantCheck,
} = require("./invariants/helpers");

const ROOT = process.cwd();

const files = mapRelativeFiles(ROOT, {
  playerExperience: "apps/web/components/player-experience-core.tsx",
  shellDynamic: "apps/web/components/shell-dynamic-core.tsx",
  shellDynamicRendering: "apps/web/components/shell-dynamic-rendering.tsx",
  coreShellSmoke: "tests/smoke/core-shell.spec.ts",
  shellLayout: "apps/web/app/(shell)/layout.tsx",
  shellErrorBoundary: "apps/web/app/(shell)/error.tsx",
  categoryErrorBoundary: "apps/web/app/(shell)/categories/[slug]/error.tsx",
  shareVideoPage: "apps/web/app/share/[videoId]/page.tsx",
  serviceFailurePanel: "apps/web/components/service-failure-panel.tsx",
  statusPerformanceRoute: "apps/web/app/api/status/performance/route.ts",
  chatRoute: "apps/web/app/api/chat/route.ts",
  apiSchemas: "apps/web/lib/api-schemas.ts",
  chatDataService: "apps/web/lib/chat-data.ts",
  chatStreamRoute: "apps/web/app/api/chat/stream/route.ts",
  categoriesFilterGrid: "apps/web/components/categories-filter-grid.tsx",
  overlayScrollReset: "apps/web/components/overlay-scroll-reset.tsx",
  appRoot: "apps/web/app",
});

function main() {
  const failures = [];

  const sources = loadSourceMap(files, ROOT, { skipKeys: ["appRoot"] });
  const playerExperienceSource = sources.playerExperience;
  const shellDynamicSource = joinFileSources([
    files.shellDynamic,
    path.join(ROOT, "apps/web/components/use-chat-state.ts"),
    path.join(ROOT, "apps/web/components/use-playlist-rail.ts"),
    path.join(ROOT, "apps/web/components/use-performance-metrics.ts"),
    path.join(ROOT, "apps/web/components/use-desktop-intro.ts"),
    path.join(ROOT, "apps/web/components/use-search-autocomplete.ts"),
  ], ROOT);
  const shellDynamicRenderingSource = sources.shellDynamicRendering;
  const shellLayoutSource = sources.shellLayout;
  const coreShellSmokeSource = sources.coreShellSmoke;
  const shellErrorBoundarySource = sources.shellErrorBoundary;
  const categoryErrorBoundarySource = sources.categoryErrorBoundary;
  const shareVideoPageSource = sources.shareVideoPage;
  const serviceFailurePanelSource = sources.serviceFailurePanel;
  const shellRenderingSource = `${shellDynamicSource}\n${shellDynamicRenderingSource}`;
  const statusPerformanceRouteSource = sources.statusPerformanceRoute;
  const chatRouteSource = sources.chatRoute;
  const apiSchemasSource = sources.apiSchemas;
  const chatDataServiceSource = sources.chatDataService;
  const chatStreamRouteSource = sources.chatStreamRoute;
  const categoriesFilterGridSource = sources.categoriesFilterGrid;
  const overlayScrollResetSource = sources.overlayScrollReset;
  const cssSource = loadCssSourceFromRoots([files.appRoot], ROOT);

  // Route loading/page duplication guardrails.
  assertFileDoesNotExist(path.join(ROOT, "apps/web/app/(shell)/top100/loading.tsx"), "Top100 route keeps loading state inside page flow (no duplicated loading.tsx)", failures, ROOT);
  assertFileDoesNotExist(path.join(ROOT, "apps/web/app/(shell)/artists/loading.tsx"), "Artists route keeps loading state inside page flow (no duplicated loading.tsx)", failures, ROOT);
  assertFileDoesNotExist(path.join(ROOT, "apps/web/app/(shell)/artists/[slug]/loading.tsx"), "Artists slug route keeps loading state inside page flow (no duplicated loading.tsx)", failures, ROOT);
  assertFileDoesNotExist(path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/loading.tsx"), "Artist route keeps loading state inside page flow (no duplicated loading.tsx)", failures, ROOT);
  assertFileDoesNotExist(path.join(ROOT, "apps/web/app/(shell)/categories/[slug]/loading.tsx"), "Category route keeps loading state inside page flow (no duplicated loading.tsx)", failures, ROOT);

  // Dock-hide interaction invariants.
  assertContains(playerExperienceSource, 'window.dispatchEvent(new CustomEvent("ytr:dock-hide-request"));', "Dock close control dispatches hide-only event instead of navigating away", failures);
  assertContains(shellDynamicSource, "const handleDockHideRequest = () => {", "Shell defines a dock-hide event handler", failures);
  assertContains(shellDynamicSource, "setIsDockHidden(true);", "Shell hides docked player in response to dock-hide event", failures);
  assertContains(shellDynamicSource, 'window.addEventListener(DOCK_HIDE_REQUEST_EVENT, handleDockHideRequest);', "Shell subscribes to dock-hide requests", failures);
  assertContains(shellDynamicSource, 'window.removeEventListener(DOCK_HIDE_REQUEST_EVENT, handleDockHideRequest);', "Shell cleans up dock-hide listener", failures);
  assertContains(shellDynamicSource, "if (shouldDockDesktopPlayer) {", "Shell restores hidden dock when entering docked overlay routes", failures);
  assertContains(shellDynamicSource, "}, [pathname, shouldDockDesktopPlayer]);", "Shell re-evaluates dock visibility on overlay route changes", failures);
  assertContains(shellDynamicSource, '<div className="playerDockLayer">', "Shell keeps player content in a dedicated dock layer", failures);
  assertContains(shellDynamicSource, "const UNDOCK_SETTLE_DURATION_MS = 220;", "Shell defines an undock-settle duration", failures);
  assertContains(shellDynamicSource, "const FOOTER_EARLY_REVEAL_DELAY_MS = 0;", "Shell triggers footer reveal immediately during undock", failures);
  assertContains(shellDynamicSource, "footerRevealTimeoutRef.current = window.setTimeout(() => {", "Shell schedules deterministic footer reveal reset timeout", failures);
  assertContains(shellDynamicSource, "setIsFooterRevealActive(false);", "Shell eventually clears footer reveal state after the reveal window", failures);
  assertContains(shellDynamicSource, "}, FOOTER_REVEAL_DURATION_MS);", "Shell keeps footer reveal visibility window aligned with reveal duration", failures);
  assertContains(shellDynamicSource, "const [isUndockSettling, setIsUndockSettling] = useState(false);", "Shell tracks undock settle state", failures);
  assertContains(shellDynamicSource, 'isUndockSettling ? "playerChromeUndockSettling" : "",', "Shell applies undock-settle class to player chrome", failures);

  // Dock sizing hot-reload.
  assertContains(shellDynamicSource, "const frame = chrome.querySelector(\".playerFrame, .playerLoadingFallback\") as HTMLElement | null;", "Shell computes dock sizing using either player frame or loading fallback", failures);

  // Denied deep-link loop guard.
  assertContains(shellDynamicSource, "const deniedRequestedVideoIdRef = useRef<string | null>(null);", "Shell tracks denied requested video ids", failures);
  assertContains(shellDynamicSource, "if (deniedRequestedVideoIdRef.current === requestedVideoId) {", "Shell skips repeated denied requested video resolution", failures);
  assertContains(shellDynamicSource, "if (requestedVideoId === lastVideoIdRef.current && isResolvingRequestedVideo) {", "Shell avoids duplicate in-flight resolve loops for same requested id", failures);
  assertNotContains(shellDynamicSource, "params.delete(\"v\");", "Shell no longer mutates URL to clear denied video id", failures);
  assertNotContains(shellDynamicSource, "params.delete(\"resume\");", "Shell no longer removes resume marker on denied id", failures);

  // CSS: dock layer and overlay chrome.
  assertContains(cssSource, ".playerDockLayer", "CSS defines dedicated dock layer sizing", failures);
  assertContains(cssSource, ".playerChromeDockedHidden .playerDockLayer", "Dock-hide class only hides player layer, not overlay page", failures);
  assertContains(cssSource, ".overlayIconBtn.overlayDockCloseBtn", "Dock close button keeps explicit red styling with high specificity", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .overlayCenter,", "Undocking keeps overlay center pinned to avoid play-button reflow", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndockSettling .overlayCenter {", "Undock settling keeps overlay center pinned", failures);
  assertContains(cssSource, ".playerOverlayVisible .overlayCenter {", "Overlay center visible-state rules are explicitly defined", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop .playerDockLayer {", "Docked desktop player keeps a dedicated dock layer rule", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop .playerDockLayer", "position: relative;", "Docked desktop player dock layer preserves relative positioning for transformed frame anchoring", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop .playerDockLayer", "overflow: visible;", "Docked desktop player dock layer must remain unclipped so transformed frame can escape parent bounds", failures);
  assertCssRuleNotContains(cssSource, ".playerChromeDockedDesktop .playerDockLayer", "overflow: hidden;", "Docked desktop player dock layer must never clip transformed frame", failures);
  assertContains(cssSource, ".heroGridOverlayRoute .playerChrome {", "Overlay route defines dedicated player chrome stacking context", failures);
  assertContains(cssSource, "overflow: visible;", "Overlay route keeps player chrome overflow visible while docked", failures);
  assertContains(cssSource, "z-index: 25;", "Overlay route player chrome keeps docked player above occluded rail layers", failures);
  assertContains(cssSource, "pointer-events: auto;", "Overlay controls remain interactive in CSS", failures);

  // CSS: docked player size scaling.
  assertContains(cssSource, ".playerChromeDockedDesktop:not(.playerChromeUndocking):not(.playerChromeUndockSettling) .overlayVolumeSlider {", "Docked-only volume scaling is scoped away from undock/settle states", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop:not(.playerChromeUndocking):not(.playerChromeUndockSettling) .overlayProgress {", "Docked-only scrub scaling is scoped away from undock/settle states", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop:not(.playerChromeUndocking):not(.playerChromeUndockSettling) .playerBootBars {", "Docked loading animation receives dedicated sizing rule", failures);
  assertContains(cssSource, "height: 56px;", "Docked loading bars are scaled to 2x height", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop:not(.playerChromeUndocking):not(.playerChromeUndockSettling) .playerBootLoader p {", "Docked loading text has a dedicated sizing rule", failures);
  assertContains(cssSource, "font-size: 1.9rem;", "Docked loading text scales to 2x size", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop:not(.playerChromeUndocking):not(.playerChromeUndockSettling) .playerBootRefreshBtn {", "Docked retry button has dedicated sizing rule", failures);
  assertContains(cssSource, "width: 88px;", "Docked retry button scales to 2x width", failures);
  assertContains(cssSource, "@keyframes playerBootPulseDocked {", "Docked loading bars use dedicated 2x animation keyframes", failures);
  assertContains(cssSource, "height: 52px;", "Docked loading pulse reaches 2x peak height", failures);
  assertContains(cssSource, "transition: width 520ms cubic-bezier(0.2, 0.92, 0.34, 1), height 520ms cubic-bezier(0.2, 0.92, 0.34, 1);", "Overlay controls animate size transitions during undock", failures);
  assertContains(cssSource, "gap 520ms cubic-bezier(0.2, 0.92, 0.34, 1),", "Overlay bottom animates gap to final geometry", failures);
  assertContains(cssSource, "padding 520ms cubic-bezier(0.2, 0.92, 0.34, 1);", "Overlay bottom animates padding to final geometry", failures);

  // CSS: overlay scroll container.
  assertContains(cssSource, ".favouritesBlindInner {", "Overlay scroll container keeps a dedicated favouritesBlindInner rule", failures);
  assertContains(cssSource, "scrollbar-gutter: stable;", "Overlay scroll container reserves scrollbar gutter to avoid header reflow when content loads", failures);

  // CSS: undocking footer transitions.
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .playerDockLayer {", "Undocking keeps a dedicated dock-layer handoff rule", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .playerDockLayer", "position: static;", "Undocking dock-layer handoff removes positioned ancestor so footer layer can anchor to player chrome", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .playerDockLayer", "padding-bottom: 74px;", "Undocking dock-layer handoff reserves footer height in layout", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .playerFooterReserve {", "Undocking footer is lifted to dedicated layer", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .playerFooterReserve", "position: absolute;", "Undocking footer layer is decoupled from frame transform layout", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .playerFooterReserve", "bottom: 0;", "Undocking footer layer stays pinned to chrome bottom", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .playerFooterReserve", "min-height: 74px;", "Undocking footer layer preserves stable final footer height", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions {", "Undocking footer actions keep a dedicated rule", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions", "position: relative !important;", "Undocking footer actions immediately switch to final non-docked layout", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions", "padding: 12px 0 !important;", "Undocking footer actions preserve the final non-docked vertical padding before reveal", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions", "visibility: hidden !important;", "Undocking footer actions stay hidden until reveal class is applied", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions", "transition: none !important;", "Undocking footer actions disable layout transitions to avoid docked-layout flash", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActionsMainRow {", "Undocking footer main row has dedicated layout override", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActionsMainRow", "display: contents;", "Undocking footer main row uses contents layout to match final geometry", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking.playerChromeFooterReveal .primaryActions {", "Undocking footer reveal uses dedicated class-gated rule", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking.playerChromeFooterReveal .primaryActions", "visibility: visible !important;", "Undocking footer reveal explicitly flips visibility only after final layout is active", failures);
  assertContains(cssSource, ".playerChrome:not(.playerChromeDockedDesktop) .primaryActions {", "Non-docked footer geometry has dedicated stable sizing rule", failures);
  assertCssRuleContains(cssSource, ".playerChrome:not(.playerChromeDockedDesktop) .primaryActions", "min-height: 74px;", "Non-docked footer preserves stable min-height during undock handoff", failures);
  assertContains(cssSource, ".playerChromeFooterReveal .primaryActions {", "Footer reveal keeps a dedicated animation rule", failures);
  assertCssRuleNotContains(cssSource, ".playerChromeFooterReveal .primaryActions", "transform:", "Footer reveal animation must avoid transform to prevent vertical flicker", failures);

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

  // Chat UI invariants.
  assertContains(shellDynamicSource, "const globalEvents = new EventSource(\"/api/chat/stream?mode=global\");", "Shell subscribes to global chat stream", failures);
  assertContains(shellDynamicSource, "shouldShowOverlayPanel:", "Shell passes a computed overlay gate to chat state hook", failures);
  assertContains(shellDynamicSource, "&& pathname !== \"/new\"", "Shell keeps chat rail mounted while New overlay is open", failures);
  assertContains(shellDynamicSource, "&& pathname !== \"/top100\"", "Shell keeps chat rail mounted while Top 100 overlay is open", failures);
  assertContains(shellDynamicSource, "&& pathname !== \"/favourites\"", "Shell keeps chat rail mounted while Favourites overlay is open", failures);
  assertContains(shellDynamicSource, "&& pathname !== \"/history\"", "Shell keeps chat rail mounted while History overlay is open", failures);
  assertContains(shellDynamicSource, "&& pathname !== \"/account\"", "Shell keeps chat rail mounted while Account overlay is open", failures);
  assertContains(shellDynamicSource, "&& !pathname.startsWith(\"/playlists\")", "Shell keeps chat rail mounted while playlists overlays are open", failures);
  assertContains(shellDynamicSource, "&& (pathname !== \"/artists\" && !pathname.startsWith(\"/artists/\") && !pathname.startsWith(\"/artist/\"))", "Shell keeps chat rail mounted while artist overlays are open", failures);
  assertContains(shellDynamicSource, "&& (pathname !== \"/categories\" && !pathname.startsWith(\"/categories/\"))", "Shell keeps chat rail mounted while category overlays are open", failures);
  assertContains(shellDynamicSource, 'setChatMode("magazine");', "Shell keeps Magazine tab selectable in chat rail", failures);
  assertContains(shellDynamicSource, 'router.push(`/magazine?v=${encodeURIComponent(currentVideo.id)}`, { scroll: true });', "Magazine tab still navigates to /magazine with video ID when not on a magazine route", failures);
  assertContains(shellDynamicSource, "if (!isMagazineOverlayRoute) {", "Magazine tab navigation is guarded by !isMagazineOverlayRoute to prevent stray ?v= injection when already on a magazine route", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(`/api/chat?${params.toString()}`);", "Shell loads chat via authenticated API call", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(\"/api/chat\", {", "Shell posts chat messages via authenticated API call", failures);
  assertContains(shellDynamicSource, "const response = await fetch(\"/api/magazine/latest?limit=8\", { cache: \"no-store\" });", "Shell hydrates magazine rail entries from latest magazine API data", failures);
  assertContains(shellDynamicSource, 'className={isAdminOverlayRoute ? "railTabs railTabsAdminOverlay" : "railTabs"}', "Shell uses dedicated admin overlay rail tab layout class", failures);
  assertContains(shellDynamicSource, "setChatMode(\"online\");", "Shell keeps Who's Online tab selectable in chat rail", failures);
  assertNotContains(shellDynamicSource, '<span className="tabLabel activeTab">Global Chat</span>', "Shell no longer hard-locks admin rail to a non-interactive Global Chat label", failures);
  assertContains(shellDynamicSource, "node.scrollTop = node.scrollHeight;", "Shell auto-scrolls chat list to latest message", failures);
  assertContains(shellRenderingSource, 'fetch(`/api/videos/share-preview?v=${encodeURIComponent(videoId)}`)', "Shared chat cards resolve preview metadata via share-preview API", failures);
  assertContains(shellRenderingSource, 'export { REQUEST_VIDEO_REPLAY_EVENT }', "Shell re-exports the replay-request event constant from events-contract", failures);
  assertContains(shellRenderingSource, "window.dispatchEvent(new CustomEvent(REQUEST_VIDEO_REPLAY_EVENT, {", "Shell dispatches replay request when shared chat card is clicked", failures);

  // Overlay open request and optimistic fallback.
  assertContains(shellDynamicSource, 'const routeLoadingLabel = pathname.endsWith("/wiki") || pendingOverlayOpenKind === "wiki" ? "Loading wiki" : "Loading video";', "Shell loading fallback derives wiki-aware copy including optimistic wiki opens", failures);
  assertContains(shellDynamicSource, '} from "@/lib/events-contract"', "Shell imports event constants from the centralized events-contract module", failures);
  assertContains(shellDynamicSource, 'window.addEventListener(OVERLAY_OPEN_REQUEST_EVENT, handleOverlayOpenRequest);', "Shell listens for optimistic overlay-open requests", failures);
  assertContains(shellDynamicSource, 'const isCategoriesOverlayPendingOrActive = isCategoriesRoute', "Shell tracks when categories overlay is pending or active", failures);
  assertContains(shellDynamicSource, 'const isArtistsOverlayPendingOrActive = isArtistsOverlayPath(pathname)', "Shell tracks when artists overlay is pending or active", failures);
  assertContains(shellDynamicSource, 'isCategoriesOverlayPendingOrActive ? (', "Shell uses categories-specific optimistic fallback while route content resolves", failures);
  assertContains(shellDynamicSource, ') : isArtistsOverlayPendingOrActive ? (', "Shell uses artists-specific optimistic fallback while route content resolves", failures);
  assertContains(shellDynamicSource, 'className="categoriesFilterSection" aria-busy="true"', "Shell categories fallback renders full categories header skeleton immediately", failures);
  assertContains(shellDynamicSource, 'className="categoriesLoaderOverlay" role="status" aria-live="polite" aria-label="Loading categories"', "Shell categories fallback keeps dedicated loader overlay visible", failures);
  assertContains(shellDynamicSource, 'if (item.href === "/categories" || item.href === "/artists") {', "Shell dispatches optimistic overlay-open request for artists and categories nav buttons", failures);
  assertContains(shellDynamicSource, 'className="routeContractRow artistLoadingCenter" role="status" aria-live="polite" aria-label="Loading artists"', "Shell artists fallback renders loading animation after overlay opens", failures);
  assertContains(shellDynamicSource, '<span>Loading artists...</span>', "Shell artists fallback renders loading label", failures);
  assertNotContains(shellDynamicSource, 'key={overlayRouteKey}', "Shell overlay suspense no longer keys on route key to avoid remount animation replay", failures);

  // Desktop intro preload guard invariants.
  assertContains(shellDynamicSource, "const [isDesktopIntroPreload, setIsDesktopIntroPreload] = useState(false);", "Desktop intro preload state defaults to false to avoid remount click-blocking", failures);
  assertContains(shellDynamicSource, "const introPlayedInSession = window.sessionStorage.getItem(DESKTOP_INTRO_PLAYED_SESSION_KEY) === \"1\";", "Desktop intro auto-run checks session marker before replaying", failures);
  assertContains(shellDynamicSource, "if (hasStartedAutoDesktopIntroRef.current || introWindow.__ytrDesktopIntroAutoPlayed || introPlayedInSession) {", "Desktop intro auto-run is guarded for already-played tabs", failures);
  assertContains(shellDynamicSource, "setIsDesktopIntroPreload(false);", "Desktop intro guard clears preload state when auto-run is skipped", failures);
  assertContains(shellDynamicSource, "const shouldRenderDesktopIntro = pathname === \"/\" && (isDesktopIntroPreload || isDesktopIntroActive);", "Desktop intro rendering is scoped to the home route", failures);
  assertContains(shellDynamicSource, "shouldRenderDesktopIntro && isDesktopIntroPreload ? \"shellDesktopIntroPreload\" : \"\"", "Shell applies preload class only when intro should render", failures);
  assertContains(shellDynamicSource, "{shouldRenderDesktopIntro ? (", "Shell only mounts desktop intro overlay when intro should render", failures);
  assertContains(coreShellSmokeSource, "await expect(shell).not.toHaveClass(/shellDesktopIntroPreload/);", "Core smoke test asserts no preload class leak after close cycles", failures);
  assertContains(coreShellSmokeSource, "closing New reveals footer promptly during close flow", "Core smoke suite includes explicit prompt footer reveal timing regression test", failures);
  assertContains(coreShellSmokeSource, "const actions = document.querySelector(\".playerFooterReserve .primaryActions\") as HTMLElement | null;", "Core smoke test reads footer action element visibility during close flow", failures);
  assertContains(coreShellSmokeSource, "return style.visibility !== \"hidden\" && Number.parseFloat(style.opacity || \"0\") > 0.01;", "Core smoke test computes footer visibility from rendered styles", failures);
  assertContains(coreShellSmokeSource, "await expect(page).toHaveURL(/\\/(\\?.*)?$/);", "Core smoke test keeps close-flow assertion anchored to home-route completion", failures);
  assertContains(coreShellSmokeSource, "const revealLatencyMs = Date.now() - closeClickStartedAt;", "Core smoke test measures close-click to footer-reveal latency", failures);
  assertContains(coreShellSmokeSource, "expect(revealLatencyMs).toBeLessThanOrEqual(1500);", "Core smoke test enforces bounded prompt footer reveal timing window", failures);

  // Categories open/loading/reveal contract invariants.
  assertContains(categoriesFilterGridSource, 'const [isLoaderVisible, setIsLoaderVisible] = useState(genreCards.length === 0);', "Categories grid tracks explicit loader visibility state", failures);
  assertContains(categoriesFilterGridSource, 'const [isLoaderFadingOut, setIsLoaderFadingOut] = useState(false);', "Categories grid tracks loader fade-out phase", failures);
  assertContains(categoriesFilterGridSource, 'const [hasRevealedCards, setHasRevealedCards] = useState(genreCards.length > 0);', "Categories grid initializes reveal state from hydrated cards", failures);
  assertContains(categoriesFilterGridSource, 'setIsLoaderFadingOut(true);', "Categories grid starts loader fade before showing cards", failures);
  assertContains(categoriesFilterGridSource, 'setHasRevealedCards(true);', "Categories grid enables card reveal class as part of loader handoff", failures);
  assertContains(categoriesFilterGridSource, '}, 190);', "Categories grid keeps short overlap window between loader fade and card reveal", failures);
  assertContains(categoriesFilterGridSource, 'className={`catalogGrid categoriesCatalogGrid categoriesCards${hasRevealedCards ? " categoriesCardsRevealed" : ""}`}', "Categories grid toggles reveal class for cascade animation", failures);
  assertContains(categoriesFilterGridSource, 'className="catalogCard categoryCard linkedCard categoryCardCascade"', "Categories cards opt into cascade animation class", failures);
  assertContains(categoriesFilterGridSource, 'style={{ "--category-cascade-index": index } as CSSProperties}', "Categories cards provide per-card cascade index variable", failures);
  assertContains(categoriesFilterGridSource, 'className={`categoriesLoaderOverlay${isLoaderFadingOut ? " categoriesLoaderOverlayFading" : ""}`}', "Categories loader overlay supports fade-out class state", failures);

  // Chat API invariants — route layer (auth, CSRF, rate-limit, response contract).
  assertContains(chatRouteSource, "const authResult = await requireApiAuth(request);", "Chat REST API requires authenticated session", failures);
  assertContains(chatRouteSource, "import { chatQuerySchema, createChatMessageSchema } from \"@/lib/api-schemas\";", "Chat route imports shared chat schemas", failures);
  assertContains(chatRouteSource, "chatQuerySchema.safeParse", "Chat GET validates request data with shared query schema", failures);
  assertContains(chatRouteSource, "createChatMessageSchema.safeParse", "Chat POST validates request body with shared message schema", failures);
  assertContains(apiSchemasSource, "mode: z.enum([\"global\", \"video\", \"online\"]).default(\"global\"),", "Chat GET schema validates supported chat modes", failures);
  assertContains(apiSchemasSource, "mode: z.enum([\"global\", \"video\"]),", "Chat POST schema restricts writable modes", failures);
  assertContains(apiSchemasSource, "content: z.string().trim().min(1).max(200),", "Chat POST enforces message length limits", failures);
  assertContains(chatRouteSource, "verifySameOrigin(request)", "Chat POST verifies same-origin to prevent CSRF", failures);
  assertContains(chatRouteSource, "rateLimitOrResponse(", "Chat POST applies per-user rate limit for global messages", failures);
  assertContains(chatRouteSource, "rateLimitSharedOrResponse(", "Chat POST applies room-level rate limit for global messages", failures);
  assertContains(chatRouteSource, "if (mode === \"video\")", "Chat POST applies dedicated rate limiting branch for video mode", failures);
  assertContains(chatRouteSource, "`chat:video:user:${authResult.auth.userId}:${videoId}`", "Chat POST applies per-user per-video rate limit key", failures);
  assertContains(chatRouteSource, "`chat:video:room:${videoId}`", "Chat POST applies per-video room-level rate limit key", failures);
  assertContains(chatRouteSource, "chatEvents.emit(chatChannel(mode, mode === \"video\" ? (videoId ?? null) : null), mapped);", "Chat POST emits events to room channel", failures);
  assertContains(chatRouteSource, "return NextResponse.json({ ok: true, message: mapped }, { status: 201 });", "Chat POST returns created message payload", failures);

  // Chat data service invariants — service layer purity and safety.
  assertNotContains(chatDataServiceSource, "from \"next/server\"", "Chat data service is free of HTTP layer imports (next/server)", failures);
  assertNotContains(chatDataServiceSource, "NextResponse", "Chat data service does not construct HTTP responses", failures);
  assertContains(chatDataServiceSource, "function escapeIdentifier", "Chat data service uses an identifier-escaping helper to prevent SQL injection", failures);
  assertContains(chatDataServiceSource, "identifier.replace(/`/g, \"``\")", "Chat data service escapes backtick characters in SQL identifiers", failures);
  assertContains(chatDataServiceSource, "LIMIT 20", "Chat data service caps message query at 20 rows", failures);
  assertContains(chatDataServiceSource, "LIMIT 80", "Chat data service caps online presence query at 80 users", failures);
  assertContains(chatDataServiceSource, "ONLINE_PRESENCE_TOUCH_INTERVAL_MS", "Chat data service defines a throttle interval for online presence touches", failures);
  assertContains(chatDataServiceSource, "ONLINE_PRESENCE_TOUCH_CACHE_TTL_MS", "Chat data service defines a cache TTL for the online presence touch map", failures);
  assertContains(chatDataServiceSource, "export async function touchOnlinePresenceThrottled", "Chat data service exports the throttled online-presence touch function", failures);
  assertContains(chatDataServiceSource, "function mapChatMessage(", "Chat data service retains an internal message-row mapper helper", failures);
  assertNotContains(chatDataServiceSource, "export function mapChatMessage", "Chat data service keeps mapChatMessage internal to avoid widening service API surface", failures);
  assertContains(chatDataServiceSource, "export async function fetchChatMessages", "Chat data service exports fetchChatMessages", failures);
  assertContains(chatDataServiceSource, "export async function fetchOnlineUsers", "Chat data service exports fetchOnlineUsers", failures);
  assertContains(chatDataServiceSource, "export async function insertChatMessage", "Chat data service exports insertChatMessage", failures);
  assertContains(chatDataServiceSource, "export async function getMessageColumns", "Chat data service exports the schema-introspection helper for messages table", failures);

  // Chat stream API invariants.
  assertContains(chatStreamRouteSource, "getOptionalApiAuth", "Chat stream API uses optional auth so unauthenticated users can subscribe to the global feed", failures);
  assertContains(chatStreamRouteSource, "SSE_CONNECTION_LIMIT_TOTAL", "Chat stream API defines a total SSE connection limit", failures);
  assertContains(chatStreamRouteSource, "SSE_CONNECTION_LIMIT_PER_IP", "Chat stream API defines a per-IP SSE connection limit", failures);
  assertContains(chatStreamRouteSource, "reserveSseConnectionSlot(clientIp)", "Chat stream API reserves a connection slot before opening stream", failures);
  assertContains(chatStreamRouteSource, "status: 429", "Chat stream API rejects over-capacity clients with HTTP 429", failures);
  assertContains(chatStreamRouteSource, '"Retry-After": "15"', "Chat stream API returns Retry-After header for throttled SSE clients", failures);
  assertContains(chatStreamRouteSource, "releaseSseConnectionSlot", "Chat stream API releases connection slots on stream teardown", failures);
  assertContains(chatStreamRouteSource, "const stream = new ReadableStream({", "Chat stream API uses SSE readable stream", failures);
  assertContains(chatStreamRouteSource, "controller.enqueue(encoder.encode(\": heartbeat\\n\\n\"));", "Chat stream API emits heartbeat comments", failures);
  assertContains(chatStreamRouteSource, "\"Content-Type\": \"text/event-stream\"", "Chat stream API sets SSE content type", failures);

  // CSS: performance modal.
  assertContains(cssSource, ".performanceQuickLaunch", "CSS defines top-right performance launcher styles", failures);
  assertContains(cssSource, ".performanceModalOverlay", "CSS defines darkened/blurred performance modal backdrop", failures);
  assertContains(cssSource, "backdrop-filter: blur(8px) saturate(0.82);", "Performance modal backdrop keeps blur treatment", failures);
  assertContains(cssSource, ".performanceModalDialog", "CSS defines centered performance modal dialog styles", failures);
  assertContains(cssSource, ".performanceDialGrid", "CSS defines dial grid layout for performance modal", failures);

  // CSS: categories loading and reveal.
  assertContains(cssSource, '.categoriesLoaderOverlay {', "Categories loader overlay styles are defined", failures);
  assertContains(cssSource, 'inset: -16px 0 0 0;', "Categories loader overlay closes header-to-loader seam", failures);
  assertContains(cssSource, '.categoriesLoaderBootLoader .playerBootBars {', "Categories loader bars have dedicated size overrides", failures);
  assertContains(cssSource, '.categoriesLoaderBootLoader .playerBootBars span {', "Categories loader bar segments have dedicated animation overrides", failures);
  assertNotContains(cssSource, 'height: 8px !important;', "Categories loader bars must not force fixed bar height that flattens pulse animation", failures);
  assertContains(cssSource, '.categoriesCards.categoriesCardsRevealed .categoryCardCascade {', "Categories cards use revealed-state animation selector", failures);
  assertContains(cssSource, 'animation: categoryCardCascadeIn 240ms ease-out both;', "Categories cards animate in with cascade keyframes", failures);
  assertContains(cssSource, 'animation-delay: calc(var(--category-cascade-index, 0) * 24ms);', "Categories card cascade delay uses index variable", failures);

  // Shared service-failure panel extraction invariants.
  assertContains(serviceFailurePanelSource, "export function ServiceFailurePanel", "Shared service-failure panel component is exported", failures);
  assertContains(serviceFailurePanelSource, "serviceFailureScreen", "Shared service-failure panel renders the serviceFailureScreen wrapper", failures);
  assertContains(serviceFailurePanelSource, "serviceFailureActions", "Shared service-failure panel renders the serviceFailureActions slot", failures);
  assertContains(shellLayoutSource, 'import { ServiceFailurePanel } from "@/components/service-failure-panel";', "Shell layout imports shared service-failure panel", failures);
  assertContains(shellErrorBoundarySource, 'import { ServiceFailurePanel } from "@/components/service-failure-panel";', "Shell error boundary imports shared service-failure panel", failures);
  assertContains(categoryErrorBoundarySource, 'import { ServiceFailurePanel } from "@/components/service-failure-panel";', "Category error boundary imports shared service-failure panel", failures);
  assertContains(shareVideoPageSource, 'import { ServiceFailurePanel } from "@/components/service-failure-panel";', "Share page imports shared service-failure panel", failures);
  assertNotContains(shellLayoutSource, "function renderServiceUnavailablePanel()", "Shell layout no longer keeps local duplicated renderServiceUnavailablePanel helper", failures);

  // Overlay scroll-reset invariants.
  assertContains(overlayScrollResetSource, "export function OverlayScrollReset()", "Single shared scroll-reset component exported as OverlayScrollReset", failures);
  assertContains(overlayScrollResetSource, "useOverlayScrollContainerRef", "Scroll-reset reads the shared overlay scroll container ref", failures);
  assertContains(shellDynamicSource, "<OverlayScrollContainerProvider overlayScrollContainerRef={favouritesBlindInnerRef}>", "Shell provides shared overlay scroll container ref context", failures);
  assertContains(overlayScrollResetSource, 'window.scrollTo({ top: 0, left: 0, behavior: "auto" })', "Scroll-reset resets window scroll position", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Overlay routing invariant check failed.",
    successMessage: "Overlay routing invariant check passed.",
  });
}

main();
