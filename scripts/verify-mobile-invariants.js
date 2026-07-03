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
  mobilePlayerContext: path.join(ROOT, "apps/web/app/m/_components/mobile-player-context.tsx"),
  mobileYouTubePlayer: path.join(ROOT, "apps/web/app/m/_components/mobile-youtube-player.tsx"),
  mobileVideoCard: path.join(ROOT, "apps/web/app/m/_components/mobile-video-card.tsx"),
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
];

const mobileComponentFiles = [
  files.mobilePlayerContext,
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

  // Mobile redirect must go to /m, not /desktop-only
  assertContains(proxySource, 'redirectUrl.pathname = "/m"', "proxy redirects mobile users to /m", failures);
  assertNotContains(proxySource, 'redirectUrl.pathname = "/desktop-only"', "proxy no longer redirects to /desktop-only", failures);

  // /m prefix must be excluded from the redirect check
  assertContains(proxySource, '!pathname.startsWith("/m")', "proxy excludes /m from mobile redirect", failures);

  // /desktop-only page must still be reachable for backwards compat
  assertContains(proxySource, 'pathname !== "/desktop-only"', "proxy excludes /desktop-only from redirect", failures);

  // isBrowserPageNav must also exclude /m (silent auth refresh)
  // Count occurrences of !pathname.startsWith — should appear at least twice (redirect guard + nav guard)
  const startsWithMCount = (proxySource.match(/pathname\.startsWith\("\/m"\)/g) || []).length;
  if (startsWithMCount < 2) {
    failures.push("proxy must exclude /m from both redirect AND isBrowserPageNav checks");
  }

  // ── 3. Mobile layout structure ─────────────────────────────────────
  const layoutSource = readFileStrict(files.mobileLayout, ROOT);

  assertContains(layoutSource, '"use client"', "mobile layout is a client component", failures);
  assertContains(layoutSource, 'MobilePlayerProvider', "mobile layout wraps children in MobilePlayerProvider", failures);
  assertContains(layoutSource, 'className="mobile-shell"', "mobile layout renders mobile-shell div", failures);
  assertContains(layoutSource, 'className="mobile-topbar"', "mobile layout renders topbar", failures);
  assertContains(layoutSource, 'className="mobile-hamburger"', "mobile layout renders hamburger button", failures);
  assertContains(layoutSource, 'className="mobile-logo-text"', "mobile layout renders logo text", failures);
  assertContains(layoutSource, 'mobile-nav-drawer', "mobile layout renders nav drawer", failures);
  assertContains(layoutSource, 'className="mobile-content"', "mobile layout renders content area", failures);
  assertContains(layoutSource, 'className="mobile-player-bar"', "mobile layout renders bottom player bar", failures);
  assertContains(layoutSource, 'className="mobile-player-fullscreen"', "mobile layout renders fullscreen player", failures);
  assertContains(layoutSource, 'className="mobile-player-wrapper"', "mobile layout renders player wrapper", failures);
  assertContains(layoutSource, 'function MobileShell', "mobile layout defines MobileShell function", failures);
  assertContains(layoutSource, 'useMobilePlayer()', "mobile layout uses MobilePlayer context", failures);

  // Nav items must include all expected routes
  const navItems = ["/m", "/m/new", "/m/categories", "/m/artists", "/m/top100", "/m/favourites", "/m/search"];
  for (const item of navItems) {
    assertContains(layoutSource, item, `mobile nav includes ${item}`, failures);
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

  // ── 5. Page structure — every page is a client component ────────────
  for (const pageFile of mobilePageFiles) {
    const source = readFileStrict(pageFile, ROOT);
    assertContains(source, '"use client"', `${path.relative(ROOT, pageFile)} is a client component`, failures);
    assertContains(source, 'export default function', `${path.relative(ROOT, pageFile)} has a default export`, failures);
  }

  // ── 6. Page import hygiene — sub-pages import from ../_components/ ──
  const subPageFiles = [
    files.mobileNew,
    files.mobileTop100,
    files.mobileSearch,
    files.mobileFavourites,
  ];
  for (const pageFile of subPageFiles) {
    const source = readFileStrict(pageFile, ROOT);
    assertContains(source, '../_components/mobile-video-card', `${path.relative(ROOT, pageFile)} imports from ../_components/`, failures);
  }

  // Deep-nested pages import from ../../_components/
  for (const pageFile of [files.mobileCategoriesSlug, files.mobileArtistSlug]) {
    const source = readFileStrict(pageFile, ROOT);
    assertContains(source, '../../_components/mobile-video-card', `${path.relative(ROOT, pageFile)} imports from ../../_components/`, failures);
  }

  // ── 7. Video card element type and keyboard accessibility ────────────
  const videoCardSource = readFileStrict(files.mobileVideoCard, ROOT);

  // Outer element must be <div role="button"> — NOT a raw <button> (would
  // cause nested-button hydration errors with inner MobileFavouriteButton).
  assertNotContains(videoCardSource, "<button", "mobile-video-card outer element is not a <button> (prevents nested-button regression)", failures);
  assertContains(videoCardSource, 'role="button"', "mobile-video-card preserves button semantics via ARIA role", failures);
  assertContains(videoCardSource, "tabIndex={0}", "mobile-video-card is keyboard-focusable", failures);
  assertContains(videoCardSource, "onKeyDown", "mobile-video-card handles keyboard activation", failures);

  // ── 8. Categories page uses real API fields (not nonexistent slug/label) ──
  const categoriesPageSource = readFileStrict(files.mobileCategories, ROOT);
  assertContains(categoriesPageSource, "getGenreSlug", "categories page imports getGenreSlug for slug computation", failures);
  assertContains(categoriesPageSource, "cat.genre", "categories page uses cat.genre from API response", failures);

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
    ".mobile-logo-text",
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
  assertContains(cssSource, ".mobile-loading-spinner", "mobile CSS defines .mobile-loading-spinner", failures);
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
