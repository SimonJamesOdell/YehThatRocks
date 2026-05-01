#!/usr/bin/env node

// Domain: Magazine guest access and route behaviour
// Covers: chatMode initialisation on magazine routes, startup video selection
// suppression, magazine rail navigation (no stray ?v= params), not-found pages,
// shouldRunChat magazine exception, CSS classes for magazine overlay UI.

const path = require("node:path");
const fs = require("node:fs");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
} = require("./invariants/helpers");

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
};

files.appRoot = path.join(ROOT, "apps/web/app");

function collectCssFiles(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) {
    return acc;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectCssFiles(fullPath, acc);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".css")) {
      acc.push(fullPath);
    }
  }

  return acc;
}

function main() {
  const failures = [];

  const shellDynamicSource = [
    readFileStrict(files.shellDynamic, ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-chat-state.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-playlist-rail.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-performance-metrics.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-desktop-intro.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-search-autocomplete.ts'), ROOT),
  ].join('\n');
  const cssSource = collectCssFiles(files.appRoot)
    .map((filePath) => readFileStrict(filePath, ROOT))
    .join("\n");
  const proxySource = readFileStrict(files.proxyMiddleware, ROOT);
  const chatRouteSource = readFileStrict(files.chatRoute, ROOT);
  const chatStreamRouteSource = readFileStrict(files.chatStreamRoute, ROOT);

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
  const isMagazineIdx = shellDynamicSource.indexOf("const isMagazineOverlayRoute =");
  const shouldRunChatIdx = shellDynamicSource.indexOf("const shouldRunChat =");
  if (isMagazineIdx === -1) {
    failures.push("isMagazineOverlayRoute constant is missing from shell");
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
    "const shouldRunChat = (!shouldShowOverlayPanel || isMagazineOverlayRoute) && (isAuthenticated || chatMode === \"global\");",
    "shouldRunChat permits chat to load on magazine routes when chatMode is 'global'",
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
    "// Don't inject a ?v= into the URL while the user is browsing the magazine",
    "Startup video selection effect documents the magazine suppression rationale",
    failures,
  );
  // The isMagazineOverlayRoute early return must appear before hasResolvedInitialVideoRef check.
  // Use single-line markers that are unique to the startup selection effect.
  const magazineCommentIdx = shellDynamicSource.indexOf(
    "// Don't inject a ?v= into the URL while the user is browsing the magazine",
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
    "router.push(`/magazine/${encodeURIComponent(track.slug)}`)",
    "Magazine rail card onClick navigates to article slug without appending ?v=",
    failures,
  );
  assertNotContains(
    shellDynamicSource,
    "router.push(`/magazine/${encodeURIComponent(track.slug)}?v=",
    "Magazine rail card onClick must not append a video ID to the article URL",
    failures,
  );

  // --- Root not-found redirects to home ---
  if (fs.existsSync(files.rootNotFound)) {
    const rootNotFoundSource = readFileStrict(files.rootNotFound, ROOT);
    assertContains(
      rootNotFoundSource,
      'redirect("/")',
      "Root not-found page immediately redirects to the homepage",
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

  if (failures.length > 0) {
    console.error("Magazine invariant check FAILED.");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log("Magazine invariant check passed.");
}

main();
