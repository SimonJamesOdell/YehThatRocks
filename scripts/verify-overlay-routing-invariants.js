#!/usr/bin/env node

// Domain: Overlay Routing
// Covers: dock-hide interaction, dock CSS / undocking animation, performance modal,
// performance API, denied deep-link loop guard, chat UI, chat API, categories
// open/loading/reveal contract.

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
  assertCssRuleContains,
  assertCssRuleNotContains,
} = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  shellDynamicRendering: path.join(ROOT, "apps/web/components/shell-dynamic-rendering.tsx"),
  statusPerformanceRoute: path.join(ROOT, "apps/web/app/api/status/performance/route.ts"),
  chatRoute: path.join(ROOT, "apps/web/app/api/chat/route.ts"),
  chatStreamRoute: path.join(ROOT, "apps/web/app/api/chat/stream/route.ts"),
  categoriesFilterGrid: path.join(ROOT, "apps/web/components/categories-filter-grid.tsx"),
  categoriesLoading: path.join(ROOT, "apps/web/app/(shell)/categories/loading.tsx"),
  css: path.join(ROOT, "apps/web/app/globals.css"),
};

function main() {
  const failures = [];

  const playerExperienceSource = readFileStrict(files.playerExperience, ROOT);
  const shellDynamicSource = readFileStrict(files.shellDynamic, ROOT);
  const shellDynamicRenderingSource = readFileStrict(files.shellDynamicRendering, ROOT);
  const shellRenderingSource = `${shellDynamicSource}\n${shellDynamicRenderingSource}`;
  const statusPerformanceRouteSource = readFileStrict(files.statusPerformanceRoute, ROOT);
  const chatRouteSource = readFileStrict(files.chatRoute, ROOT);
  const chatStreamRouteSource = readFileStrict(files.chatStreamRoute, ROOT);
  const categoriesFilterGridSource = readFileStrict(files.categoriesFilterGrid, ROOT);
  const categoriesLoadingSource = readFileStrict(files.categoriesLoading, ROOT);
  const cssSource = readFileStrict(files.css, ROOT);

  // Dock-hide interaction invariants.
  assertContains(playerExperienceSource, 'window.dispatchEvent(new CustomEvent("ytr:dock-hide-request"));', "Dock close control dispatches hide-only event instead of navigating away", failures);
  assertContains(shellDynamicSource, "const handleDockHideRequest = () => {", "Shell defines a dock-hide event handler", failures);
  assertContains(shellDynamicSource, "setIsDockHidden(true);", "Shell hides docked player in response to dock-hide event", failures);
  assertContains(shellDynamicSource, 'window.addEventListener("ytr:dock-hide-request", handleDockHideRequest);', "Shell subscribes to dock-hide requests", failures);
  assertContains(shellDynamicSource, 'window.removeEventListener("ytr:dock-hide-request", handleDockHideRequest);', "Shell cleans up dock-hide listener", failures);
  assertContains(shellDynamicSource, "if (shouldDockDesktopPlayer) {", "Shell restores hidden dock when entering docked overlay routes", failures);
  assertContains(shellDynamicSource, "}, [pathname, shouldDockDesktopPlayer]);", "Shell re-evaluates dock visibility on overlay route changes", failures);
  assertContains(shellDynamicSource, '<div className="playerDockLayer">', "Shell keeps player content in a dedicated dock layer", failures);
  assertContains(shellDynamicSource, "const UNDOCK_SETTLE_DURATION_MS = 220;", "Shell defines an undock-settle duration", failures);
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
  assertCssRuleContains(cssSource, ".heroGridOverlayRoute .playerChrome", "overflow: visible;", "Overlay route keeps player chrome overflow visible while docked", failures);
  assertCssRuleContains(cssSource, ".heroGridOverlayRoute .playerChrome", "z-index: 25;", "Overlay route player chrome keeps docked player above occluded rail layers", failures);
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
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions {", "Undocking footer actions keep a dedicated rule", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions", "position: relative;", "Undocking footer actions use in-flow relative positioning to avoid handoff reflow", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions", "padding: 2px 0;", "Undocking footer actions retain the tuned vertical padding", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions", "visibility: hidden;", "Undocking footer actions stay hidden while preserving geometry", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActionsMainRow {", "Undocking footer main row has dedicated layout override", failures);
  assertCssRuleContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActionsMainRow", "display: contents;", "Undocking footer main row uses contents layout to match final geometry", failures);
  assertContains(cssSource, ".playerChromeDockedDesktop.playerChromeUndocking .primaryActions button,", "Undocking footer control sizing has dedicated overrides", failures);
  assertContains(cssSource, "height: 10px;", "Undocking footer control height remains tuned to the current lock-in value", failures);
  assertContains(cssSource, "min-height: 10px;", "Undocking footer control min-height remains tuned to the current lock-in value", failures);
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
  assertContains(shellDynamicSource, 'setChatMode("magazine");', "Shell keeps Magazine tab selectable in chat rail", failures);
  assertContains(shellDynamicSource, 'router.push(`/magazine?v=${encodeURIComponent(currentVideo.id)}`, { scroll: true });', "Magazine tab opens magazine landing route", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(`/api/chat?${params.toString()}`);", "Shell loads chat via authenticated API call", failures);
  assertContains(shellDynamicSource, "const response = await fetchWithAuthRetry(\"/api/chat\", {", "Shell posts chat messages via authenticated API call", failures);
  assertContains(shellDynamicSource, "const latestMagazineTracks = useMemo(() => magazineDraftEdition.tracks, []);", "Shell hydrates magazine rail entries from magazine draft data", failures);
  assertContains(shellDynamicSource, 'className={isAdminOverlayRoute ? "railTabs railTabsAdminOverlay" : "railTabs"}', "Shell uses dedicated admin overlay rail tab layout class", failures);
  assertContains(shellDynamicSource, "onClick={() => setChatMode(\"online\")}", "Shell keeps Who's Online tab selectable in chat rail", failures);
  assertNotContains(shellDynamicSource, '<span className="tabLabel activeTab">Global Chat</span>', "Shell no longer hard-locks admin rail to a non-interactive Global Chat label", failures);
  assertContains(shellDynamicSource, "node.scrollTop = node.scrollHeight;", "Shell auto-scrolls chat list to latest message", failures);
  assertContains(shellRenderingSource, 'fetch(`/api/videos/share-preview?v=${encodeURIComponent(videoId)}`)', "Shared chat cards resolve preview metadata via share-preview API", failures);
  assertContains(shellRenderingSource, "const REQUEST_VIDEO_REPLAY_EVENT = \"ytr:request-video-replay\";", "Shell defines replay-request event constant for shared chat cards", failures);
  assertContains(shellRenderingSource, "window.dispatchEvent(new CustomEvent(REQUEST_VIDEO_REPLAY_EVENT, {", "Shell dispatches replay request when shared chat card is clicked", failures);

  // Overlay open request and optimistic fallback.
  assertContains(shellDynamicSource, 'const routeLoadingLabel = pathname.endsWith("/wiki") || pendingOverlayOpenKind === "wiki" ? "Loading wiki" : "Loading video";', "Shell loading fallback derives wiki-aware copy including optimistic wiki opens", failures);
  assertContains(shellDynamicSource, 'const OVERLAY_OPEN_REQUEST_EVENT = "ytr:overlay-open-request";', "Shell defines an optimistic overlay-open request event constant", failures);
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

  // Categories open/loading/reveal contract invariants.
  assertContains(categoriesLoadingSource, 'className="categoriesFilterSection" aria-busy="true"', "Categories route loading screen renders immediate shell section", failures);
  assertContains(categoriesLoadingSource, 'className="favouritesBlindBar categoriesHeaderBar"', "Categories route loading screen renders header row immediately", failures);
  assertContains(categoriesLoadingSource, 'className="categoriesFilterInput"', "Categories route loading screen renders filter input immediately", failures);
  assertContains(categoriesLoadingSource, 'className="playerBootBars" aria-hidden="true"', "Categories route loading screen renders animated loading bars", failures);
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

  if (failures.length > 0) {
    console.error("Overlay routing invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Overlay routing invariant check passed.");
}

main();
