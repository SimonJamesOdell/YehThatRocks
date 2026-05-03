#!/usr/bin/env node

const path = require("node:path");
const {
  readFileStrict,
  collectCssFiles,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  historyPage: path.join(ROOT, "apps/web/app/(shell)/history/page.tsx"),
  historyList: path.join(ROOT, "apps/web/components/history-infinite-list.tsx"),
  watchHistoryRoute: path.join(ROOT, "apps/web/app/api/watch-history/route.ts"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  appRoot: path.join(ROOT, "apps/web/app"),
};

function main() {
  const failures = [];

  const historyPageSource = readFileStrict(files.historyPage, ROOT);
  const historyListSource = readFileStrict(files.historyList, ROOT);
  const watchHistoryRouteSource = readFileStrict(files.watchHistoryRoute, ROOT);
  const apiSchemasSource = readFileStrict(files.apiSchemas, ROOT);
  const catalogDataSource = readFileStrict(files.catalogData, ROOT);
  const globalCssSource = collectCssFiles(files.appRoot)
    .map((filePath) => readFileStrict(filePath, ROOT))
    .join("\n");

  // --- History page: server-side auth and data loading ---
  assertContains(historyPageSource, "getCurrentAuthenticatedUser", "History page resolves current authenticated user server-side", failures);
  assertContains(historyPageSource, "getWatchHistory(user.id", "History page loads watch history for authenticated user only", failures);
  assertContains(historyPageSource, "user ? await getWatchHistory", "History page returns empty history for unauthenticated visitors", failures);
  assertContains(historyPageSource, "HistoryInfiniteList", "History page delegates list rendering to HistoryInfiniteList", failures);
  assertContains(historyPageSource, "initialHistory={initialHistory}", "History page passes server-loaded history to HistoryInfiniteList", failures);
  assertContains(historyPageSource, "initialHasMore={hasMore}", "History page passes hasMore flag to HistoryInfiniteList", failures);
  assertContains(historyPageSource, "isAuthenticated={Boolean(user)}", "History page passes authentication state to HistoryInfiniteList", failures);
  assertContains(historyPageSource, "historyPagePanel", "History page uses historyPagePanel class for full-width layout", failures);

  // --- HistoryInfiniteList: structure and pagination ---
  assertContains(historyListSource, '"use client"', "HistoryInfiniteList is a client component", failures);
  assertContains(historyListSource, "useInfiniteScroll", "HistoryInfiniteList uses shared useInfiniteScroll hook", failures);
  assertContains(historyListSource, "/api/watch-history?limit=", "HistoryInfiniteList paginates via /api/watch-history", failures);
  assertContains(historyListSource, "cache: \"no-store\"", "HistoryInfiniteList fetches history pages with no-store cache", failures);
  assertContains(historyListSource, "historyGroups", "HistoryInfiniteList groups items by date", failures);
  assertContains(historyListSource, "historyDateGroup", "HistoryInfiniteList renders per-date section elements", failures);
  assertContains(historyListSource, "historyDateHeading", "HistoryInfiniteList renders per-date heading", failures);
  assertContains(historyListSource, "historyTimeBadge", "HistoryInfiniteList shows time badge per entry", failures);
  assertContains(historyListSource, "AddToPlaylistButton", "HistoryInfiniteList integrates AddToPlaylistButton on history cards", failures);
  assertContains(historyListSource, "className=\"historyCardAction\"", "HistoryInfiniteList renders history card playlist action wrapper", failures);
  assertContains(historyListSource, "className=\"historyCardPlaylistAddButton\"", "HistoryInfiniteList applies history-specific playlist add button class", failures);
  assertContains(historyListSource, "historyPagePanel", "HistoryInfiniteList uses historyPagePanel class for full-width layout", failures);

  // --- HistoryInfiniteList: link performance (no eager prefetch fan-out) ---
  assertContains(historyListSource, "prefetch={false}", "History links disable Next.js route prefetch to prevent per-item fan-out", failures);
  assertContains(historyListSource, '/?v=${encodeURIComponent(entry.video.id)}&resume=1', "History links navigate with v+resume query parameters", failures);

  // --- HistoryInfiniteList: no direct current-video API calls ---
  assertNotContains(historyListSource, "/api/current-video", "HistoryInfiniteList must not call /api/current-video per item", failures);

  // --- HistoryInfiniteList: artist attribution ---
  assertContains(historyListSource, 'import { ArtistWikiLink } from "@/components/artist-wiki-link";', "HistoryInfiniteList imports artist wiki link helper", failures);
  assertContains(historyListSource, "<ArtistWikiLink", "HistoryInfiniteList wraps artist name with wiki link", failures);

  // --- HistoryInfiniteList: watch stats display ---
  assertContains(historyListSource, "entry.watchCount", "HistoryInfiniteList displays play count per entry", failures);
  assertContains(historyListSource, "entry.maxProgressPercent", "HistoryInfiniteList displays max progress percent per entry", failures);

  // --- Watch history API route: authentication and pagination ---
  assertContains(watchHistoryRouteSource, "requireApiAuth(request)", "Watch history GET route requires authenticated session", failures);
  assertContains(watchHistoryRouteSource, "export async function GET", "Watch history route exports GET handler", failures);
  assertContains(watchHistoryRouteSource, "export async function POST", "Watch history route exports POST handler for recording events", failures);
  assertContains(watchHistoryRouteSource, "getWatchHistory(authResult.auth.userId", "Watch history GET delegates to getWatchHistory with user id", failures);
  assertContains(watchHistoryRouteSource, "hasMore", "Watch history GET returns hasMore pagination flag", failures);
  assertContains(watchHistoryRouteSource, "nextOffset", "Watch history GET returns nextOffset cursor", failures);

  // --- Watch history API route: CSRF and validation ---
  assertContains(watchHistoryRouteSource, "verifySameOrigin(request)", "Watch history POST enforces same-origin CSRF check", failures);
  assertContains(watchHistoryRouteSource, "watchHistoryEventSchema.safeParse", "Watch history POST validates body against watchHistoryEventSchema", failures);
  assertContains(watchHistoryRouteSource, "recordVideoWatch(", "Watch history POST delegates to recordVideoWatch", failures);

  // --- Schema: watchHistoryEventSchema ---
  assertContains(apiSchemasSource, "watchHistoryEventSchema", "api-schemas exports watchHistoryEventSchema", failures);

  // --- catalog-data: history data access ---
  assertContains(catalogDataSource, "getWatchHistory", "catalog-data exports getWatchHistory function", failures);
  assertContains(catalogDataSource, "recordVideoWatch", "catalog-data exports recordVideoWatch function", failures);
  // mapVideo must not fall back to the raw title as the channelTitle — only parsed/channel/inferred artist or "Unknown Artist"
  assertContains(catalogDataSource, "const displayArtist =", "mapVideo resolves display artist through explicit fallback chain", failures);
  assertContains(catalogDataSource, "\"Unknown Artist\";", "mapVideo fallback chain ends in Unknown Artist", failures);
  assertNotContains(catalogDataSource, "video.title.split(\"|\"", "mapVideo must not use raw title split as channelTitle fallback", failures);

  // --- CSS: history layout and thumbnail fix ---
  assertContains(globalCssSource, ".accountHistoryPanel", "globals.css defines .accountHistoryPanel base style", failures);
  assertContains(globalCssSource, ".historyPagePanel", "globals.css defines .historyPagePanel full-width override", failures);
  assertContains(globalCssSource, ".historyGroups", "globals.css defines .historyGroups grid layout", failures);
  assertContains(globalCssSource, ".historyDateGroup", "globals.css defines .historyDateGroup section style", failures);
  assertContains(globalCssSource, ".historyDateHeading", "globals.css defines .historyDateHeading label style", failures);
  assertContains(globalCssSource, ".historyGroupList", "globals.css defines .historyGroupList list style", failures);
  assertContains(globalCssSource, ".historyCard {", "globals.css defines .historyCard grid layout", failures);
  assertContains(globalCssSource, ".historyCard .leaderboardThumbWrap {", "globals.css scopes thumbnail wrapper to full width in history cards", failures);
  assertContains(globalCssSource, ".historyCard .accountHistoryThumb {", "globals.css overrides thumbnail dimensions for cover-fill in history cards", failures);
  assertContains(globalCssSource, ".historyTimeBadge", "globals.css defines .historyTimeBadge pill style", failures);
  assertContains(globalCssSource, ".historyTrackLink", "globals.css defines .historyTrackLink display style", failures);
  assertContains(globalCssSource, ".historyMeta", "globals.css defines .historyMeta text layout", failures);
  assertContains(globalCssSource, ".historyCardAction", "globals.css defines history card playlist action anchor", failures);
  assertContains(globalCssSource, ".historyCardPlaylistAddButton", "globals.css defines history playlist add button style", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "History UI invariant check failed.",
    successMessage: "History UI invariant check passed.",
  });
}

main();
