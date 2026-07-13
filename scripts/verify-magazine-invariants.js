#!/usr/bin/env node

// Domain: Magazine guest access and route behaviour
// Covers: chatMode initialisation on magazine routes, startup video selection
// suppression, magazine rail navigation (no stray ?v= params), not-found pages,
// shouldRunChat magazine exception, CSS classes for magazine overlay UI,
// mobile magazine scroll-position save/restore.

const path = require("node:path");
const fs = require("node:fs");
const {
  readFileStrict,
  collectCssFiles,
  assertContains,
  assertNotContains,
  assertCssRuleContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  magazineSlugPage: path.join(ROOT, "apps/web/app/(shell)/magazine/[slug]/page.tsx"),
  magazineSlugNotFound: path.join(ROOT, "apps/web/app/(shell)/magazine/[slug]/not-found.tsx"),
  rootNotFound: path.join(ROOT, "apps/web/app/not-found.tsx"),
  css: path.join(ROOT, "apps/web/app/globals.css"),
  proxyMiddleware: path.join(ROOT, "apps/web/proxy.ts"),
  chatRoute: path.join(ROOT, "apps/web/app/api/chat/route.ts"),
  chatStreamRoute: path.join(ROOT, "apps/web/app/api/chat/stream/route.ts"),
  mobileMagazineSlug: path.join(ROOT, "apps/web/app/m/magazine/[slug]/page.tsx"),
  mobileHomeClient: path.join(ROOT, "apps/web/app/m/home-client.tsx"),
  mobileCss: path.join(ROOT, "apps/web/app/styles/mobile.css"),
};

files.appRoot = path.join(ROOT, "apps/web/app");

function main() {
  const failures = [];

  const shellDynamicSource = [
    readFileStrict(files.shellDynamic, ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/shell-dynamic-rendering.tsx'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-chat-state.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-playlist-rail.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-performance-metrics.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-desktop-intro.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-search-autocomplete.ts'), ROOT),
  ].join('\n');
  const cssSource = collectCssFiles(files.appRoot)
    .map((filePath) => readFileStrict(filePath, ROOT))
    .join("\n");
  const proxySource = readFileStrict(files.proxyMiddleware, ROOT);
  const chatRouteSource = readFileStrict(files.chatRoute, ROOT);
  const chatStreamRouteSource = readFileStrict(files.chatStreamRoute, ROOT);
  const mobileHomeSource = readFileStrict(files.mobileHomeClient, ROOT);
  const mobileCssSource = readFileStrict(files.mobileCss, ROOT);

  // --- File existence ---
  for (const [key, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath)) {
      failures.push(`Required file missing: ${path.relative(ROOT, filePath)} (${key})`);
    }
  }

  // --- chatMode lazy initialisation ---
  // chatMode must initialise to "magazine" when arriving on a magazine route.
  assertContains(
    shellDynamicSource,
    'useState<ChatMode>(() =>',
    "chatMode uses a lazy initialiser function so the initial value is computed from pathname",
    failures,
  );
  assertContains(
    shellDynamicSource,
    'initialPathname === "/magazine" || initialPathname.startsWith("/magazine/")',
    "chatMode lazy initialiser yields 'magazine' for magazine route arrivals",
    failures,
  );

  // --- chatMode reset-on-auth effect guards magazine route ---
  // The effect that resets chatMode to "global" when auth state changes must not
  // fire on magazine routes — otherwise it overwrites the lazy initialiser.
  // Check both the guard condition and the conditional setChatMode call are present.
  assertContains(
    shellDynamicSource,
    "if (!isMagazineOverlayRoute) {",
    "Shell has an !isMagazineOverlayRoute guard in the chatMode reset-on-auth effect",
    failures,
  );
  // The reset/sync effect should depend on isMagazineOverlayRoute.
  assertContains(
    shellDynamicSource,
    "}, [isMagazineOverlayRoute]);",
    "chatMode magazine sync effect lists isMagazineOverlayRoute in its dependency array",
    failures,
  );

  // --- isMagazineOverlayRoute must be declared before shouldRunChat ---
  const isMagazineIdxDirect = shellDynamicSource.indexOf("const isMagazineOverlayRoute =");
  const isMagazineIdxDestructured = shellDynamicSource.indexOf("isMagazineOverlayRoute,");
  const isMagazineIdx = isMagazineIdxDirect === -1 ? isMagazineIdxDestructured : isMagazineIdxDirect;
  const shouldRunChatIdx = shellDynamicSource.indexOf("const shouldRunChat =");
  if (isMagazineIdx === -1) {
    failures.push("isMagazineOverlayRoute derivation is missing from shell");
  } else if (shouldRunChatIdx === -1) {
    failures.push("shouldRunChat constant is missing from shell");
  } else if (isMagazineIdx > shouldRunChatIdx) {
    failures.push(
      "isMagazineOverlayRoute must be declared before shouldRunChat so it can be referenced in the shouldRunChat expression",
    );
  }

  // --- shouldRunChat allows chat to load on magazine routes ---
  assertContains(
    shellDynamicSource,
    "const shouldRunChat = (!shouldShowOverlayPanel || isMagazineOverlayRoute || isForumOverlayRoute) && (isAuthenticated || chatMode === \"global\" || chatMode === \"online\");",
    "shouldRunChat permits chat to load on magazine/forum routes while preserving guest global/online tabs",
    failures,
  );

  // --- chatMode useEffect syncs to magazine route on navigation ---
  assertContains(
    shellDynamicSource,
    "setChatMode(\"magazine\");",
    "Shell has a setChatMode('magazine') call for mid-session navigation to magazine routes",
    failures,
  );
  assertContains(
    shellDynamicSource,
    "}, [isMagazineOverlayRoute]);",
    "Magazine chatMode sync effect depends only on isMagazineOverlayRoute",
    failures,
  );

  // --- Startup video selection suppressed on magazine routes ---
  assertContains(
    shellDynamicSource,
    "// Don't inject a ?v= into the URL while the user is browsing the",
    "Startup video selection effect documents the magazine suppression rationale",
    failures,
  );
  // The isMagazineOverlayRoute early return must appear before hasResolvedInitialVideoRef check.
  // Use single-line markers that are unique to the startup selection effect.
  const magazineCommentIdx = shellDynamicSource.indexOf(
    "// Don't inject a ?v= into the URL while the user is browsing the",
  );
  const startupResolvedGuardIdx = shellDynamicSource.indexOf("if (hasResolvedInitialVideoRef.current)");
  if (magazineCommentIdx === -1) {
    failures.push("Startup selection effect is missing the isMagazineOverlayRoute early-return guard");
  } else if (startupResolvedGuardIdx !== -1 && magazineCommentIdx > startupResolvedGuardIdx) {
    failures.push("isMagazineOverlayRoute guard must appear before hasResolvedInitialVideoRef check in startup selection effect");
  }

  // --- Magazine tab does not navigate when already on a magazine route ---
  // Verify the navigation call exists AND is wrapped in the !isMagazineOverlayRoute guard.
  // We check both are present; the order ensures the guard wraps the push.
  assertContains(
    shellDynamicSource,
    "if (!isMagazineOverlayRoute) {",
    "Shell has a !isMagazineOverlayRoute guard (used by magazine tab and reset-on-auth effect)",
    failures,
  );
  // The router.push for the Magazine tab must still exist (for non-magazine routes).
  assertContains(
    shellDynamicSource,
    "router.push(`/magazine?v=${encodeURIComponent(currentVideo.id)}`, { scroll: true });",
    "Magazine tab still navigates to /magazine with video ID when not on a magazine route",
    failures,
  );

  // --- Magazine rail cards navigate without appending ?v= ---
  // The article slug navigation must not carry a video ID query param.
  assertContains(
    shellDynamicSource,
    "router.push(`/magazine/${encodeURIComponent(slug)}`)",
    "Magazine rail card onClick navigates to article slug without appending ?v=",
    failures,
  );
  assertNotContains(
    shellDynamicSource,
    "router.push(`/magazine/${encodeURIComponent(slug)}?v=",
    "Magazine rail card onClick must not append a video ID to the article URL",
    failures,
  );

  // --- Root not-found page renders a proper 404 ---
  // Redirect was replaced with a static 404 page to prevent a client-side
  // navigation race. The page must not contain raw <html> or <body> tags —
  // the root layout already provides those.
  if (fs.existsSync(files.rootNotFound)) {
    const rootNotFoundSource = readFileStrict(files.rootNotFound, ROOT);
    assertContains(
      rootNotFoundSource,
      "404",
      "Root not-found page displays a 404 indicator",
      failures,
    );
    assertContains(
      rootNotFoundSource,
      'href="/"',
      "Root not-found page offers a back-to-home link",
      failures,
    );
    assertNotContains(
      rootNotFoundSource,
      "<html",
      "Root not-found page must not contain raw <html> tag (root layout provides it)",
      failures,
    );
    assertNotContains(
      rootNotFoundSource,
      "<body",
      "Root not-found page must not contain raw <body> tag (root layout provides it)",
      failures,
    );
  }

  // --- Magazine slug not-found renders overlay-aware error page ---
  if (fs.existsSync(files.magazineSlugNotFound)) {
    const magazineNotFoundSource = readFileStrict(files.magazineSlugNotFound, ROOT);
    assertContains(
      magazineNotFoundSource,
      'className="magazinePage"',
      "Magazine slug not-found uses magazinePage layout class",
      failures,
    );
    assertContains(
      magazineNotFoundSource,
      "CloseLink",
      "Magazine slug not-found renders a CloseLink so users can dismiss the overlay",
      failures,
    );
    assertContains(
      magazineNotFoundSource,
      "404",
      "Magazine slug not-found surfaces a 404 indicator",
      failures,
    );
    assertContains(
      magazineNotFoundSource,
      'href="/magazine"',
      "Magazine slug not-found offers a back-to-magazine navigation link",
      failures,
    );
    assertContains(
      magazineNotFoundSource,
      "magazineNotFoundPanel",
      "Magazine slug not-found uses magazineNotFoundPanel styling class",
      failures,
    );
  }

  // --- Mobile magazine proxy redirect ---
  // When a mobile user lands on a shared magazine link, the proxy must
  // redirect to the mobile magazine page, not just /m.
  assertContains(
    proxySource,
    'pathname.startsWith("/magazine")',
    "resolveMobilePathname maps /magazine routes to /m/magazine for mobile users",
    failures,
  );
  assertContains(
    proxySource,
    'return "/m" + pathname',
    "resolveMobilePathname preserves the magazine sub-path through mobile redirect",
    failures,
  );

  // --- Mobile magazine article page exists ---
  if (fs.existsSync(files.mobileMagazineSlug)) {
    const mobileMagazineSource = readFileStrict(files.mobileMagazineSlug, ROOT);
    assertContains(
      mobileMagazineSource,
      "mobile-magazine-article",
      "Mobile magazine article page renders with mobile-magazine-article class",
      failures,
    );
    assertContains(
      mobileMagazineSource,
      "getArticleBySlug",
      "Mobile magazine article page fetches article data from magazine-data",
      failures,
    );
  } else {
    failures.push("Mobile magazine article page is missing — shared magazine links will break on mobile");
  }

  // --- Mobile magazine scroll-position save/restore ─────────────────────
  // The mobile home page uses a tab-content scroll container (overflow-y: auto)
  // with a locked document body (overflow: hidden).  Scroll position must be
  // saved/restored from the tab-content element, not window.
  assertContains(
    mobileHomeSource,
    "const tabContentRef = useRef<HTMLDivElement>(null);",
    "Mobile home page declares tabContentRef for scroll-position tracking",
    failures,
  );
  assertContains(
    mobileHomeSource,
    'className="mobile-home-tab-content" ref={tabContentRef}',
    "tabContentRef is attached to .mobile-home-tab-content scroll container",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "sessionStorage.setItem(MAGAZINE_SCROLL_KEY, String(tabContentRef.current?.scrollTop ?? 0))",
    "Magazine card onClick saves tabContentRef.current.scrollTop (not window.scrollY)",
    failures,
  );
  assertNotContains(
    mobileHomeSource,
    "window.scrollY",
    "Magazine scroll save must not reference window.scrollY (body is overflow:hidden)",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "tabContentRef.current.scrollTop = y;",
    "Magazine scroll restore sets tabContentRef.current.scrollTop (not window.scrollTo)",
    failures,
  );
  assertNotContains(
    mobileHomeSource,
    "window.scrollTo",
    "Magazine scroll restore must not call window.scrollTo (body is overflow:hidden)",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "if (isNaN(y) || y < 0) return;",
    "Scroll restore guard uses y < 0 (position 0 is valid)",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "sessionStorage.removeItem(MAGAZINE_SCROLL_KEY);",
    "Scroll position is cleared from sessionStorage after successful restore",
    failures,
  );

  // --- Mobile magazine scroll CSS invariants ────────────────────────────
  assertContains(
    mobileCssSource,
    "html:has(.mobile-home-page),",
    "Mobile CSS locks html scroll for home page",
    failures,
  );
  assertContains(
    mobileCssSource,
    "body:has(.mobile-home-page)",
    "Mobile CSS locks body scroll for home page",
    failures,
  );
  assertCssRuleContains(
    mobileCssSource,
    "html:has(.mobile-home-page),",
    "overflow: hidden",
    "html:has(.mobile-home-page) must set overflow: hidden",
    failures,
  );
  assertCssRuleContains(
    mobileCssSource,
    ".mobile-home-tab-content {",
    "overflow-y: auto",
    ".mobile-home-tab-content must be the scroll container (overflow-y: auto)",
    failures,
  );

  // --- Mobile magazine cache persistence (back-navigation support) ──────
  // Without cache persistence, the article list would be empty after
  // navigating back, making scroll restoration irrelevant.
  assertContains(
    mobileHomeSource,
    "const MAGAZINE_CACHE_KEY = \"mobile-magazine-cache\";",
    "Mobile home page declares MAGAZINE_CACHE_KEY for article-list persistence",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "function readMagazineCache",
    "Mobile home page defines readMagazineCache helper",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "function writeMagazineCache",
    "Mobile home page defines writeMagazineCache helper",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "writeMagazineCache(magazineArticles, magazineHasMore, magazineOffsetRef.current);",
    "Magazine articles are persisted to sessionStorage after every render",
    failures,
  );
  assertContains(
    mobileHomeSource,
    "sessionStorage.getItem(MAGAZINE_CACHE_KEY)",
    "Magazine cache is read from sessionStorage on tab activation",
    failures,
  );

  // --- Guest chat reads: proxy allows unauthenticated access to chat endpoints ---
  assertContains(
    proxySource,
    '"/api/chat"',
    "Proxy middleware lists /api/chat as an auth-optional endpoint so guests can read chat",
    failures,
  );

  // --- Chat route uses optional auth for GET so guests can read messages ---
  assertContains(
    chatRouteSource,
    "getOptionalApiAuth",
    "Chat GET handler uses getOptionalApiAuth so unauthenticated users can read messages",
    failures,
  );

  // --- Chat SSE stream uses optional auth so guests can subscribe ---
  assertContains(
    chatStreamRouteSource,
    "getOptionalApiAuth",
    "Chat SSE stream uses getOptionalApiAuth so unauthenticated users can subscribe to the global feed",
    failures,
  );

  // --- Magazine arrival flag is reset when user authenticates ---
  // didArriveOnMagazineRouteRef persists across renders and controls
  // shouldHidePlayerForMagazineGuest. It must be cleared when auth succeeds
  // so the player appears immediately after sign-in on a magazine route.
  assertContains(
    shellDynamicSource,
    "didArriveOnMagazineRouteRef.current = false;",
    "Shell resets the magazine arrival flag at least once (useAuthSuccessListener + auto-login success paths)",
    failures,
  );
  // Verify the flag appears in the useAuthSuccessListener callback (auth state sync).
  const authSuccessListenerIdx = shellDynamicSource.indexOf("useAuthSuccessListener((state, source) => {");
  const magazineRefInAuthSuccessIdx = shellDynamicSource.indexOf(
    "didArriveOnMagazineRouteRef.current = false;",
    authSuccessListenerIdx,
  );
  if (magazineRefInAuthSuccessIdx === -1) {
    failures.push("didArriveOnMagazineRouteRef.current = false must appear inside useAuthSuccessListener callback");
  }
  // Verify the flag also appears in the auto-login effect (separate from useAuthSuccessListener).
  // Count occurrences — there should be at least 3 (useAuthSuccessListener + 2 auto-login success paths).
  const refResetCount = (shellDynamicSource.match(/didArriveOnMagazineRouteRef\.current = false;/g) || []).length;
  if (refResetCount < 3) {
    failures.push(`didArriveOnMagazineRouteRef.current = false appears ${refResetCount} times; expected at least 3 (useAuthSuccessListener + 2 auto-login success paths)`);
  }

  // --- Guest chat composer visible when unauthenticated ---
  assertContains(
    shellDynamicSource,
    'className="guestChatComposer"',
    "Shell renders a guest chat composer for unauthenticated users",
    failures,
  );
  assertContains(
    shellDynamicSource,
    'className="navLink navLinkActive guestChatSignInBtn"',
    "Guest chat composer includes a sign-in CTA button",
    failures,
  );

  // --- CSS ---
  assertContains(cssSource, ".magazineNotFoundPanel {", "CSS defines .magazineNotFoundPanel for in-overlay 404 styling", failures);
  assertContains(cssSource, ".guestChatComposer", "CSS defines .guestChatComposer for unauthenticated chat footer", failures);
  assertContains(cssSource, ".guestChatSignInBtn", "CSS defines .guestChatSignInBtn CTA button style", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Magazine invariant check FAILED.",
    successMessage: "Magazine invariant check passed.",
  });
}

main();