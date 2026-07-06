#!/usr/bin/env node

// Domain: Mobile Experience
// Covers: proxy.ts mobile redirect, mobile file structure, mobile CSS classes,
// mobile component integrity, and import-path hygiene.
// Run after adding/removing mobile pages or changing proxy routing.

const path = require("node:path");
const {
  readFileStrict,
  mapRelativeFiles,
  loadSourceMap,
  assertFilesExist,
  assertContains,
  assertNotContains,
  assertMatches,
  assertCssRuleContains,
  assertFileDoesNotExist,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  proxy: path.join(ROOT, "apps/web/proxy.ts"),
  mobileLayout: path.join(ROOT, "apps/web/app/m/layout.tsx"),
  mobileHome: path.join(ROOT, "apps/web/app/m/page.tsx"),
  mobileNew: path.join(ROOT, "apps/web/app/m/new/page.tsx"),
  mobileCategories: path.join(ROOT, "apps/web/app/m/categories/page.tsx"),
  mobileCategoriesSlug: path.join(ROOT, "apps/web/app/m/categories/[slug]/page.tsx"),
  mobileArtists: path.join(ROOT, "apps/web/app/m/artists/page.tsx"),
  mobileArtistSlug: path.join(ROOT, "apps/web/app/m/artist/[slug]/page.tsx"),
  mobileTop100: path.join(ROOT, "apps/web/app/m/top100/page.tsx"),
  mobileSearch: path.join(ROOT, "apps/web/app/m/search/page.tsx"),
  mobileFavourites: path.join(ROOT, "apps/web/app/m/favourites/page.tsx"),
  mobileLogin: path.join(ROOT, "apps/web/app/m/login/page.tsx"),
  mobileAccount: path.join(ROOT, "apps/web/app/m/account/page.tsx"),
  mobileMagazineSlug: path.join(ROOT, "apps/web/app/m/magazine/[slug]/page.tsx"),
  mobileRegister: path.join(ROOT, "apps/web/app/m/register/page.tsx"),
  mobileResetPassword: path.join(ROOT, "apps/web/app/m/reset-password/page.tsx"),
  mobileVerifyEmail: path.join(ROOT, "apps/web/app/m/verify-email/page.tsx"),
  mobilePlayerContext: path.join(ROOT, "apps/web/components/mobile/mobile-player-context.tsx"),
  mobileShell: path.join(ROOT, "apps/web/components/mobile/mobile-shell.tsx"),
  mobileFavouriteButton: path.join(ROOT, "apps/web/components/mobile/mobile-favourite-button.tsx"),
  mobileYouTubePlayer: path.join(ROOT, "apps/web/components/mobile/mobile-youtube-player.tsx"),
  mobileVideoCard: path.join(ROOT, "apps/web/components/mobile/mobile-video-card.tsx"),
  mobileCss: path.join(ROOT, "apps/web/app/styles/mobile.css"),
  globalsCss: path.join(ROOT, "apps/web/app/globals.css"),
  desktopOnlyPage: path.join(ROOT, "apps/web/app/desktop-only/page.tsx"),
  // Old route group must NOT exist
  oldMobileLayout: path.join(ROOT, "apps/web/app/(mobile)/layout.tsx"),
};

const mobilePageFiles = [
  files.mobileHome,
  files.mobileNew,
  files.mobileCategories,
  files.mobileCategoriesSlug,
  files.mobileArtists,
  files.mobileArtistSlug,
  files.mobileTop100,
  files.mobileSearch,
  files.mobileFavourites,
  files.mobileLogin,
  files.mobileAccount,
  files.mobileMagazineSlug,
  files.mobileRegister,
  files.mobileResetPassword,
  files.mobileVerifyEmail,
];

const mobileComponentFiles = [
  files.mobilePlayerContext,
  files.mobileShell,
  files.mobileFavouriteButton,
  files.mobileYouTubePlayer,
  files.mobileVideoCard,
];

function main() {
  const failures = [];

  // ── 1. File existence ──────────────────────────────────────────────
  assertFilesExist(
    mapRelativeFiles(ROOT, {
      proxy: "apps/web/proxy.ts",
      mobileLayout: "apps/web/app/m/layout.tsx",
      mobileCss: "apps/web/app/styles/mobile.css",
      globalsCss: "apps/web/app/globals.css",
      desktopOnlyPage: "apps/web/app/desktop-only/page.tsx",
    }),
    failures,
    ROOT,
  );

  // All mobile pages must exist
  const pageFilesMap = {};
  for (const f of mobilePageFiles) {
    pageFilesMap[path.relative(ROOT, f)] = f;
  }
  assertFilesExist(pageFilesMap, failures, ROOT);

  // All mobile components must exist
  const componentFilesMap = {};
  for (const f of mobileComponentFiles) {
    componentFilesMap[path.relative(ROOT, f)] = f;
  }
  assertFilesExist(componentFilesMap, failures, ROOT);

  // Old (mobile) route group must NOT exist
  assertFileDoesNotExist(files.oldMobileLayout, "Old (mobile) route group removed", failures, ROOT);

  // ── 2. Proxy redirect rules ────────────────────────────────────────
  const proxySource = readFileStrict(files.proxy, ROOT);

  // Mobile redirect uses resolveMobilePathname to map desktop routes to
  // /m equivalents when they exist, falling back to /m otherwise.
  assertContains(proxySource, "resolveMobilePathname", "proxy defines resolveMobilePathname mapper", failures);
  assertContains(proxySource, 'redirectUrl.pathname = resolveMobilePathname(pathname)', "mobile redirect uses resolveMobilePathname", failures);
  assertNotContains(proxySource, 'redirectUrl.pathname = "/desktop-only"', "proxy no longer redirects to /desktop-only", failures);

  // /m prefix must be excluded from the redirect check
  assertContains(proxySource, '!pathname.startsWith("/m")', "proxy excludes /m from mobile redirect", failures);

  // /desktop-only page must still be reachable for backwards compat
  assertContains(proxySource, 'pathname !== "/desktop-only"', "proxy excludes /desktop-only from redirect", failures);

  // isBrowserPageNav must also exclude /m (silent auth refresh)
  const startsWithMCount = (proxySource.match(/pathname\.startsWith\("\/m"\)/g) || []).length;
  if (startsWithMCount < 2) {
    failures.push("proxy must exclude /m from both redirect AND isBrowserPageNav checks");
  }

  // resolveMobilePathname maps routes with /m equivalents to their mobile
  // page, preserving the path so deep-linked content loads directly.
  assertContains(proxySource, 'pathname.startsWith("/magazine")', "resolveMobilePathname maps magazine routes to /m/magazine", failures);
  assertContains(proxySource, 'return "/m/register"', "resolveMobilePathname maps /register to /m/register", failures);
  assertContains(proxySource, 'return "/m/reset-password"', "resolveMobilePathname maps /reset-password to /m/reset-password", failures);
  assertContains(proxySource, 'return "/m/verify-email"', "resolveMobilePathname maps /verify-email to /m/verify-email", failures);
  assertContains(proxySource, 'return "/m"', "resolveMobilePathname falls back to /m", failures);

  // Routes without /m equivalents still fall through to desktop layout
  // (forum, user profiles, history, playlists) so shared links resolve.
  assertContains(proxySource, "isDesktopOnlyContentRoute", "proxy defines isDesktopOnlyContentRoute guard for routes without mobile equivalents", failures);
  assertContains(proxySource, 'pathname.startsWith("/forum")', "forum routes excluded from mobile redirect (no mobile equivalent yet)", failures);
  assertContains(proxySource, 'pathname.startsWith("/u/")', "user profile routes excluded from mobile redirect (no mobile equivalent yet)", failures);
  assertContains(proxySource, '!isDesktopOnlyContentRoute', "isDesktopOnlyContentRoute used in shouldRedirectToMobile guard", failures);

  // Query string must be preserved through the mobile redirect so shared
  // video links (?v=abc123) survive.
  assertNotContains(proxySource, 'redirectUrl.search = ""', "proxy preserves query string through mobile redirect", failures);

  // ── 3. Mobile layout structure ─────────────────────────────────────
  // Layout is a server component — thin wrapper rendering client MobileShell
  const layoutSource = readFileStrict(files.mobileLayout, ROOT);
  assertNotContains(layoutSource, '"use client"', "mobile layout is a server component", failures);
  assertContains(layoutSource, 'MobilePlayerProvider', "mobile layout wraps children in MobilePlayerProvider", failures);
  assertContains(layoutSource, 'MobileShell', "mobile layout imports and renders MobileShell", failures);

  // Shell component (client) contains all the UI — extracted from layout
  // to fix Turbopack ChunkLoadError (client boundary outside app/ route tree)
  const shellSource = readFileStrict(files.mobileShell, ROOT);

  assertContains(shellSource, '"use client"', "mobile shell is a client component", failures);
  assertContains(shellSource, 'function MobileShell', "mobile shell defines MobileShell function", failures);
  assertContains(shellSource, 'useMobilePlayer()', "mobile shell uses MobilePlayer context", failures);
  assertContains(shellSource, 'className="mobile-shell"', "mobile shell renders mobile-shell div", failures);
  assertContains(shellSource, 'className="mobile-topbar"', "mobile shell renders topbar", failures);
  assertContains(shellSource, 'className="mobile-hamburger"', "mobile shell renders hamburger button", failures);
  assertContains(shellSource, 'mobile-nav-drawer', "mobile shell renders nav drawer", failures);
  assertContains(shellSource, 'className="mobile-content"', "mobile shell renders content area", failures);
  assertContains(shellSource, 'className="mobile-player-bar"', "mobile shell renders bottom player bar", failures);
  assertContains(shellSource, 'className="mobile-player-fullscreen"', "mobile shell renders fullscreen player", failures);
  assertContains(shellSource, 'className="mobile-player-wrapper"', "mobile shell renders player wrapper", failures);

  // Nav items must include all expected routes
  const navItems = ["/m", "/m/new", "/m/categories", "/m/artists", "/m/top100", "/m/favourites", "/m/search"];
  for (const item of navItems) {
    assertContains(shellSource, item, `mobile nav includes ${item}`, failures);
  }

  // ── 4. Player context integrity ────────────────────────────────────
  const playerContextSource = readFileStrict(files.mobilePlayerContext, ROOT);

  assertContains(playerContextSource, 'export type MobileVideo', "player context exports MobileVideo type", failures);
  assertContains(playerContextSource, 'export function useMobilePlayer', "player context exports useMobilePlayer hook", failures);
  assertContains(playerContextSource, 'export function MobilePlayerProvider', "player context exports MobilePlayerProvider", failures);
  assertContains(playerContextSource, 'YouTubePlayerHandle', "player context defines YouTubePlayerHandle interface", failures);
  assertContains(playerContextSource, 'playVideo', "player context provides playVideo", failures);
  assertContains(playerContextSource, 'pauseVideo', "player context provides pauseVideo", failures);
  assertContains(playerContextSource, 'stopVideo', "player context provides stopVideo", failures);
  assertContains(playerContextSource, 'openFullscreen', "player context provides openFullscreen", failures);
  assertContains(playerContextSource, 'closeFullscreen', "player context provides closeFullscreen", failures);

  // ── 5. Page structure — most pages are client components ────────────
  // Magazine article and auth pages are server components (they fetch data
  // or accept searchParams on the server).
  const serverComponentPages = new Set([
    files.mobileMagazineSlug,
    files.mobileRegister,
    files.mobileResetPassword,
    files.mobileVerifyEmail,
    files.mobileHome,
    files.mobileTop100,
    files.mobileFavourites,
    files.mobileCategories,
    files.mobileCategoriesSlug,
  ]);
  for (const pageFile of mobilePageFiles) {
    const source = readFileStrict(pageFile, ROOT);
    const relPath = path.relative(ROOT, pageFile);
    if (serverComponentPages.has(pageFile)) {
      assertContains(source, 'export default', `${relPath} has a default export`, failures);
      continue;
    }
    assertContains(source, '"use client"', `${relPath} is a client component`, failures);
    assertContains(source, 'export default function', `${relPath} has a default export`, failures);
  }

  // ── 6. Page import hygiene — sub-pages import from @/components/mobile/ ──
  const subPageFiles = [
    files.mobileNew,
    files.mobileTop100,
    files.mobileSearch,
    files.mobileFavourites,
  ];
  for (const pageFile of subPageFiles) {
    const source = readFileStrict(pageFile, ROOT);
    assertContains(source, '@/components/mobile/mobile-video-card', `${path.relative(ROOT, pageFile)} imports from @/components/mobile/`, failures);
  }

  // Artist page imports from @/components/mobile/
  // (category detail page is now a server component using snapshots)
  for (const pageFile of [files.mobileArtistSlug]) {
    const source = readFileStrict(pageFile, ROOT);
    assertContains(source, '@/components/mobile/mobile-video-card', `${path.relative(ROOT, pageFile)} imports from @/components/mobile/`, failures);
  }

  // ── 7. Video card element type, title pattern, and keyboard accessibility ──
  const videoCardSource = readFileStrict(files.mobileVideoCard, ROOT);

  // Outer element must be <div role="button"> — NOT a raw <button> (would
  // cause nested-button hydration errors with inner MobileFavouriteButton).
  assertNotContains(videoCardSource, "<button", "mobile-video-card outer element is not a <button> (prevents nested-button regression)", failures);
  assertContains(videoCardSource, 'role="button"', "mobile-video-card preserves button semantics via ARIA role", failures);
  assertContains(videoCardSource, "tabIndex={0}", "mobile-video-card is keyboard-focusable", failures);
  assertContains(videoCardSource, "onKeyDown", "mobile-video-card handles keyboard activation", failures);

  // Title pattern: uses parsedArtist/parsedTrack like desktop WatchNextCard
  assertContains(videoCardSource, "getArtistPagePath", "mobile-video-card imports getArtistPagePath for artist links", failures);
  assertContains(videoCardSource, "hasParsedTitlePattern", "mobile-video-card uses hasParsedTitlePattern to choose title rendering", failures);
  assertContains(videoCardSource, "parsedArtistCandidate", "mobile-video-card extracts parsedArtistCandidate", failures);
  assertContains(videoCardSource, "parsedTrackCandidate", "mobile-video-card extracts parsedTrackCandidate", failures);
  assertContains(videoCardSource, "parsedArtistLabel", "mobile-video-card computes uppercase artist label", failures);
  assertContains(videoCardSource, 'mobile-video-card-artist-link', "mobile-video-card uses artist link class for parsed titles", failures);
  assertContains(videoCardSource, "e.stopPropagation()", "mobile-video-card artist link stops propagation to prevent card activation", failures);

  // Must NOT render a separate artist span below the title (was the duplicate)
  assertNotContains(videoCardSource, 'className="mobile-video-card-artist"', "mobile-video-card no longer renders a separate artist-name span below title", failures);

  // ── 8. Categories pages use snapshot data (same source as desktop) ──
  const categoriesPageSource = readFileStrict(files.mobileCategories, ROOT);
  assertContains(categoriesPageSource, "getCategoriesNewTopLevelSnapshot", "categories page imports getCategoriesNewTopLevelSnapshot", failures);
  assertContains(categoriesPageSource, "card.genre", "categories page uses card.genre from snapshot", failures);
  assertContains(categoriesPageSource, "card.artistCount", "categories page shows artist count", failures);
  assertContains(categoriesPageSource, ".previewVideoId", "categories page renders thumbnail previews", failures);

  const categoriesSlugPageSource = readFileStrict(files.mobileCategoriesSlug, ROOT);
  assertContains(categoriesSlugPageSource, "getCategoriesNewCategorySnapshot", "categories/[slug] page imports getCategoriesNewCategorySnapshot", failures);
  assertContains(categoriesSlugPageSource, "notFound", "categories/[slug] page handles missing snapshot with notFound", failures);
  assertContains(categoriesSlugPageSource, "MobileCategoryArtistList", "categories/[slug] page renders MobileCategoryArtistList", failures);

  // ── 9. CSS is imported in globals ───────────────────────────────────
  const globalsSource = readFileStrict(files.globalsCss, ROOT);
  assertContains(globalsSource, "@import './styles/mobile.css'", "globals.css imports mobile.css", failures);

  // ── 10. CSS class coverage ──────────────────────────────────────────
  const cssSource = readFileStrict(files.mobileCss, ROOT);

  // Core shell classes
  const shellClasses = [
    ".mobile-shell",
    ".mobile-topbar",
    ".mobile-hamburger",
    ".mobile-logo-link",
    ".mobile-account-link",
    ".mobile-nav-overlay",
    ".mobile-nav-drawer",
    ".mobile-nav-drawer-open",
    ".mobile-nav-brand",
    ".mobile-nav-list",
    ".mobile-nav-link",
    ".mobile-nav-link-active",
    ".mobile-nav-footer",
    ".mobile-content",
  ];
  for (const cls of shellClasses) {
    assertContains(cssSource, cls, `mobile CSS defines ${cls}`, failures);
  }

  // Player classes
  const playerClasses = [
    ".mobile-player-bar",
    ".mobile-player-bar-button",
    ".mobile-player-bar-thumb",
    ".mobile-player-bar-info",
    ".mobile-player-bar-title",
    ".mobile-player-bar-artist",
    ".mobile-player-bar-controls",
    ".mobile-player-bar-close",
    ".mobile-player-fullscreen",
    ".mobile-player-fullscreen-topbar",
    ".mobile-player-back",
    ".mobile-player-wrapper",
    ".mobile-player-details",
    ".mobile-player-meta",
    ".mobile-player-genre-tag",
    ".mobile-player-favs",
  ];
  for (const cls of playerClasses) {
    assertContains(cssSource, cls, `mobile CSS defines ${cls}`, failures);
  }

  // Video card classes
  const videoCardClasses = [
    ".mobile-video-list",
    ".mobile-video-card",
    ".mobile-video-card-thumb",
    ".mobile-video-card-img",
    ".mobile-video-card-play-icon",
    ".mobile-video-card-info",
    ".mobile-video-card-title",
    ".mobile-video-card-artist",
    ".mobile-video-card-artist-link",
    ".mobile-video-card-genre",
  ];
  for (const cls of videoCardClasses) {
    assertContains(cssSource, cls, `mobile CSS defines ${cls}`, failures);
  }

  // Auth classes
  assertContains(cssSource, ".mobile-auth-form", "mobile CSS defines .mobile-auth-form", failures);
  assertContains(cssSource, ".mobile-auth-input", "mobile CSS defines .mobile-auth-input", failures);
  assertContains(cssSource, ".mobile-auth-submit", "mobile CSS defines .mobile-auth-submit", failures);
  assertContains(cssSource, ".mobile-auth-error", "mobile CSS defines .mobile-auth-error", failures);

  // Loading / empty state
  assertContains(cssSource, ".mobile-loading", "mobile CSS defines .mobile-loading", failures);
  assertContains(cssSource, ".mobile-empty-state", "mobile CSS defines .mobile-empty-state", failures);
  assertContains(cssSource, ".mobile-load-more", "mobile CSS defines .mobile-load-more", failures);

  // Categories / Artists / Search
  assertContains(cssSource, ".mobile-categories-grid", "mobile CSS defines .mobile-categories-grid", failures);
  assertContains(cssSource, ".mobile-category-card", "mobile CSS defines .mobile-category-card", failures);
  assertContains(cssSource, ".mobile-artists-list", "mobile CSS defines .mobile-artists-list", failures);
  assertContains(cssSource, ".mobile-artist-link", "mobile CSS defines .mobile-artist-link", failures);
  assertContains(cssSource, ".mobile-alphabet-bar", "mobile CSS defines .mobile-alphabet-bar", failures);
  assertContains(cssSource, ".mobile-alphabet-letter", "mobile CSS defines .mobile-alphabet-letter", failures);
  assertContains(cssSource, ".mobile-alphabet-letter-active", "mobile CSS defines .mobile-alphabet-letter-active", failures);
  assertContains(cssSource, ".mobile-search-form", "mobile CSS defines .mobile-search-form", failures);
  assertContains(cssSource, ".mobile-search-input", "mobile CSS defines .mobile-search-input", failures);
  assertContains(cssSource, ".mobile-search-button", "mobile CSS defines .mobile-search-button", failures);

  // Account
  assertContains(cssSource, ".mobile-account-section", "mobile CSS defines .mobile-account-section", failures);
  assertContains(cssSource, ".mobile-account-button", "mobile CSS defines .mobile-account-button", failures);

  // Magazine article
  assertContains(cssSource, ".mobile-magazine-article", "mobile CSS defines .mobile-magazine-article", failures);
  assertContains(cssSource, ".mobile-magazine-thumb", "mobile CSS defines .mobile-magazine-thumb", failures);
  assertContains(cssSource, ".mobile-magazine-body", "mobile CSS defines .mobile-magazine-body", failures);
  assertContains(cssSource, ".mobile-magazine-cta", "mobile CSS defines .mobile-magazine-cta", failures);
  assertContains(cssSource, ".mobile-magazine-related", "mobile CSS defines .mobile-magazine-related", failures);
  assertContains(cssSource, ".mobile-magazine-comments", "mobile CSS defines .mobile-magazine-comments", failures);

  // Verify email
  assertContains(cssSource, ".mobile-verify-actions", "mobile CSS defines .mobile-verify-actions", failures);
  assertContains(cssSource, ".mobile-verify-link", "mobile CSS defines .mobile-verify-link", failures);

  // ── 11. Desktop-only page still exists (not removed) ─────────────────
  const desktopOnlySource = readFileStrict(files.desktopOnlyPage, ROOT);
  assertContains(desktopOnlySource, "Put the toy down", "desktop-only page still contains placeholder text", failures);

  // ── 12. No desktop shell dependencies in mobile pages ───────────────
  const allMobileSources = [
    layoutSource,
    ...mobilePageFiles.map((f) => readFileStrict(f, ROOT)),
    ...mobileComponentFiles.map((f) => readFileStrict(f, ROOT)),
  ].join("\n");

  // Mobile code must not import from (shell) route group
  assertNotContains(allMobileSources, "from \"@/components/shell-dynamic-core\"", "mobile code does not import shell-dynamic-core", failures);
  assertNotContains(allMobileSources, "@/components/primary-nav", "mobile code does not import primary-nav", failures);
  assertNotContains(allMobileSources, "@/components/player-experience-core", "mobile code does not import player-experience-core", failures);

  // Mobile video card must NOT use the desktop YouTubeThumbnailImage
  assertNotContains(allMobileSources, 'YouTubeThumbnailImage', "mobile code does not import desktop thumbnail component", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "\nMobile invariants FAILED:",
    successMessage: "\nAll mobile invariants passed.",
  });
}

main();