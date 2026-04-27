#!/usr/bin/env node

const path = require("node:path");
const { readFileStrict, assertContains, assertNotContains } = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  searchPage: path.join(ROOT, "apps/web/app/(shell)/search/page.tsx"),
  searchRoute: path.join(ROOT, "apps/web/app/api/search/route.ts"),
  searchFlagsRoute: path.join(ROOT, "apps/web/app/api/search-flags/route.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  searchFlagData: path.join(ROOT, "apps/web/lib/search-flag-data.ts"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  searchFlagButton: path.join(ROOT, "apps/web/components/search-flag-button.tsx"),
  searchSeenToggle: path.join(ROOT, "apps/web/components/search-seen-toggle.tsx"),
  seenToggleHook: path.join(ROOT, "apps/web/components/use-seen-toggle-preference.ts"),
  seenToggleRoute: path.join(ROOT, "apps/web/app/api/seen-toggle-preferences/route.ts"),
  adminVideoEditModal: path.join(ROOT, "apps/web/components/admin-video-edit-modal.tsx"),
  adminVideoEditButton: path.join(ROOT, "apps/web/components/admin-video-edit-button.tsx"),
  adminVideoDeleteButton: path.join(ROOT, "apps/web/components/admin-video-delete-button.tsx"),
  globalCss: path.join(ROOT, "apps/web/app/globals.css"),
};

function main() {
  const failures = [];

  const searchPageSource = readFileStrict(files.searchPage, ROOT);
  const searchRouteSource = readFileStrict(files.searchRoute, ROOT);
  const searchFlagsRouteSource = readFileStrict(files.searchFlagsRoute, ROOT);
  const catalogDataSource = readFileStrict(files.catalogData, ROOT);
  const searchFlagDataSource = readFileStrict(files.searchFlagData, ROOT);
  const shellDynamicSource = readFileStrict(files.shellDynamic, ROOT);
  const searchFlagButtonSource = readFileStrict(files.searchFlagButton, ROOT);
  const searchSeenToggleSource = readFileStrict(files.searchSeenToggle, ROOT);
  const seenToggleHookSource = readFileStrict(files.seenToggleHook, ROOT);
  const seenToggleRouteSource = readFileStrict(files.seenToggleRoute, ROOT);
  const adminVideoEditModalSource = readFileStrict(files.adminVideoEditModal, ROOT);
  const adminVideoEditButtonSource = readFileStrict(files.adminVideoEditButton, ROOT);
  const adminVideoDeleteButtonSource = readFileStrict(files.adminVideoDeleteButton, ROOT);
  const globalCssSource = readFileStrict(files.globalCss, ROOT);

  // --- Search page: server-side rendering ---
  assertContains(searchPageSource, "searchCatalog(query)", "Search page calls searchCatalog server-side", failures);
  assertContains(searchPageSource, "resolvedSearchParams?.q", "Search page reads query from searchParams.q", failures);

  // Deduplication before render
  assertContains(searchPageSource, "const uniqueVideos = results.videos.filter(", "Search page deduplicates videos by id before render", failures);
  assertContains(searchPageSource, "{uniqueVideos.map((video) => {", "Search page renders deduplicated video list", failures);
  assertContains(searchPageSource, "new Map(results.artists.map((artist) => [artist.slug, artist])).values()", "Search page deduplicates artists by slug", failures);
  assertContains(searchPageSource, "new Set(results.genres)", "Search page deduplicates genres using Set", failures);
  assertContains(searchPageSource, "const seenVideoIds = user ? await getSeenVideoIdsForUser(user.id) : new Set<string>();", "Search page loads seen video ids for authenticated users", failures);
  assertContains(searchPageSource, "const isSeen = seenVideoIds.has(video.id);", "Search page computes seen status per video", failures);
  assertContains(searchPageSource, "top100CardSeen", "Search page applies seen-card darkening class used by New/Top100", failures);
  assertContains(searchPageSource, 'videoSeenBadge videoSeenBadgeOverlay', "Search page renders seen badge overlay on thumbnails", failures);
  assertContains(searchPageSource, 'import { SearchResultBlockButton } from "@/components/search-result-block-button";', "Search page imports the block button", failures);
  assertContains(searchPageSource, 'import { SearchFlagButton } from "@/components/search-flag-button";', "Search page imports the search flag button", failures);
  assertContains(searchPageSource, 'import { SearchSeenToggle } from "@/components/search-seen-toggle";', "Search page imports the seen toggle", failures);
  assertContains(searchPageSource, "const suppressedVideoIds = await getSuppressedSearchVideoIds({ userId: user?.id ?? null, query });", "Search page loads query-scoped suppressed ids", failures);
  assertContains(searchPageSource, ').filter((video) => !suppressedVideoIds.has(video.id));', "Search page filters suppressed videos from results", failures);
  assertContains(searchPageSource, '<SearchSeenToggle trackStackId="search-video-grid"', "Search page renders seen toggle for video results", failures);
  assertContains(searchPageSource, "isAuthenticated={isAuthenticated}", "Search page passes auth state into seen toggle component", failures);
  assertContains(searchPageSource, '<SearchResultBlockButton videoId={video.id} title={video.title} />', "Search page renders block button on video cards", failures);
  assertContains(searchPageSource, '<SearchFlagButton videoId={video.id} title={video.title} searchQuery={query} />', "Search page renders flag button with current query context", failures);

  // Search seen-toggle persistence invariants.
  assertContains(searchSeenToggleSource, "useSeenTogglePreference", "Search seen-toggle uses shared preference hook", failures);
  assertContains(searchSeenToggleSource, "const SEARCH_HIDE_SEEN_TOGGLE_KEY_PREFIX = \"ytr-toggle-hide-seen-search\";", "Search seen-toggle uses a dedicated key prefix", failures);
  assertContains(searchSeenToggleSource, "isAuthenticated,", "Search seen-toggle forwards auth state into preference hook", failures);
  assertContains(seenToggleHookSource, 'fetch(`/api/seen-toggle-preferences?key=${encodeURIComponent(key)}`', "Seen-toggle hook reads persisted values through API", failures);
  assertContains(seenToggleRouteSource, "seenTogglePreferenceKeySchema.safeParse", "Seen-toggle API validates query key schema for GET", failures);

  // Results: videos linked with resume flag
  assertContains(searchPageSource, "/?v=${video.id}&resume=1", "Search page video links include resume=1 flag", failures);
  assertContains(searchPageSource, 'import { ArtistWikiLink } from "@/components/artist-wiki-link";', "Search page imports artist wiki link helper", failures);
  assertContains(searchPageSource, '<ArtistWikiLink artistName={video.channelTitle} videoId={video.id} className="artistInlineLink">', "Search page wraps video artist names with wiki links", failures);

  // Results: artists and genres rendered
  assertContains(searchPageSource, "/artist/${artist.slug}", "Search page artist links route to /artist/<slug>", failures);
  assertContains(searchPageSource, "/categories/${getGenreSlug(genre)}", "Search page genre links route to /categories/<slug>", failures);
  assertContains(globalCssSource, ".artistInlineLink", "Search-linked artist names share the inline wiki-link style", failures);

  // --- Search API route: public, no authentication required ---
  assertNotContains(searchRouteSource, "requireApiAuth", "Search GET route does not require authentication (public endpoint)", failures);
  assertContains(searchRouteSource, "searchCatalog(query)", "Search API delegates to searchCatalog", failures);
  assertContains(searchRouteSource, "searchParams.get(\"q\")", "Search API reads query from searchParams.q", failures);
  assertContains(searchRouteSource, "NextResponse.json({", "Search API returns JSON response", failures);
  assertContains(searchRouteSource, "query,", "Search API response includes query echo", failures);
  assertContains(searchRouteSource, "...results", "Search API spreads catalog results into response", failures);

  // --- Search flags API route: authenticated, query-aware moderation ---
  assertContains(searchFlagsRouteSource, "requireApiAuth", "Search flags route requires authentication", failures);
  assertContains(searchFlagsRouteSource, "verifySameOrigin", "Search flags route enforces same-origin CSRF protection", failures);
  assertContains(searchFlagsRouteSource, "searchFlagSchema.safeParse", "Search flags route validates request body with search flag schema", failures);
  assertContains(searchFlagsRouteSource, "recordSearchFlag", "Search flags route persists submitted flags", failures);
  assertContains(searchFlagsRouteSource, "getSearchFlagConsensus", "Search flags route checks prior matching flags before acting", failures);
  assertContains(searchFlagsRouteSource, "appliedImmediately", "Search flags route reports whether the new flag triggered automatic action", failures);

  // --- searchCatalog data logic: full-text boolean mode ---
  assertContains(catalogDataSource, "BOOLEAN MODE", "searchCatalog uses MySQL full-text BOOLEAN MODE for prefix matching", failures);
  assertContains(catalogDataSource, "FT_MIN_WORD_LEN", "searchCatalog filters short words below ft_min_word_len before building fulltext query", failures);
  assertContains(catalogDataSource, "ftWords.map((w) => `${w}*`).join(\" \")", "searchCatalog uses prefix wildcard without mandatory + so stop-word-heavy queries still return results", failures);
  assertContains(catalogDataSource, "MATCH(title, parsedArtist, parsedTrack) AGAINST", "searchCatalog queries full-text index on title, parsedArtist, parsedTrack", failures);

  // LIKE fallback for zero fulltext results
  assertContains(catalogDataSource, "LIKE fallback", "searchCatalog has LIKE phrase fallback when fulltext returns zero results", failures);
  assertContains(catalogDataSource, "parsedArtist LIKE ${likePattern}", "searchCatalog LIKE fallback searches parsedArtist column", failures);

  // Empty query returns top videos (not empty/error)
  assertContains(catalogDataSource, "if (!normalized) {", "searchCatalog handles empty query explicitly", failures);
  assertContains(catalogDataSource, "videos: await getTopVideos(),", "searchCatalog returns top videos for empty query", failures);
  assertContains(catalogDataSource, "artists: await getArtists(),", "searchCatalog returns all artists for empty query", failures);

  // Fallback to seed data on DB failure
  assertContains(catalogDataSource, "searchSeedCatalog(query)", "searchCatalog falls back to seed catalog when DB query fails", failures);
  assertContains(catalogDataSource, "console.error(\"[searchCatalog] query failed, falling back to seed:\"", "searchCatalog logs DB query failure before falling back", failures);
  assertContains(catalogDataSource, "getSearchRankingSignals({", "searchCatalog consults stored search-flag signals before returning results", failures);
  assertContains(catalogDataSource, "rankingSignals.suppressedVideoIds.has(video.videoId)", "searchCatalog suppresses consensus-bad videos for the current query", failures);
  assertContains(catalogDataSource, "rankingSignals.penaltyByVideoId.get(video.videoId)", "searchCatalog demotes repeatedly-flagged videos in ranking", failures);

  // Artist search efficiency guardrails (5-minute cache + in-flight dedupe).
  assertContains(catalogDataSource, "const ARTIST_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;", "Catalog data defines artist search cache TTL", failures);
  assertContains(catalogDataSource, "const artistSearchCache = new Map", "Catalog data stores artist search cache entries", failures);
  assertContains(catalogDataSource, "const artistSearchInFlight = new Map", "Catalog data tracks in-flight artist search requests", failures);
  assertContains(catalogDataSource, "const searchCacheKey = `s:${normalizedSearch}|l:${cappedLimit}|o:${orderByName ? 1 : 0}|p:${prefixOnly ? 1 : 0}|n:${nameOnly ? 1 : 0}`;", "Catalog data keys artist search cache by normalized query and mode", failures);
  assertContains(catalogDataSource, "const inFlight = artistSearchInFlight.get(searchCacheKey);", "Catalog data reuses in-flight artist search work", failures);
  assertContains(catalogDataSource, "artistSearchCache.set(searchCacheKey", "Catalog data writes artist search cache after query completion", failures);

  // Partial fallback: seed used only when DB returns empty results
  assertContains(catalogDataSource, "videos.length > 0 ? videos.map(mapVideo) : searchSeedCatalog(query).videos", "searchCatalog falls back to seed videos when DB returns zero results", failures);
  assertContains(catalogDataSource, "artists.length > 0 ? artists.map(mapArtist) : searchSeedCatalog(query).artists", "searchCatalog falls back to seed artists when DB returns zero results", failures);

  // --- Search flag persistence and UI wiring ---
  assertContains(searchFlagDataSource, "CREATE TABLE IF NOT EXISTS search_result_flags", "Search flag data layer creates persistence table on demand", failures);
  assertContains(searchFlagDataSource, "normalized_query", "Search flag data layer stores flags against normalized query text", failures);
  assertContains(searchFlagDataSource, "SEARCH_FLAG_MIN_USERS_FOR_ACTION", "Search flag data layer uses a consensus threshold before automatic action", failures);
  assertContains(searchFlagDataSource, "getSearchRankingSignals", "Search flag data layer exposes ranking penalties and suppressions", failures);
  assertContains(searchFlagButtonSource, 'fetch("/api/search-flags"', "Search flag button posts to the dedicated search flags API", failures);
  assertContains(searchFlagButtonSource, "query: searchQuery", "Search flag button submits the active search query with the flag", failures);
  assertContains(searchFlagButtonSource, "searchResultCardRemoving", "Search flag button removes the card immediately after successful flagging", failures);
  assertContains(globalCssSource, ".searchResultCardRemoving", "Search UI includes removal animation styling", failures);
  assertContains(globalCssSource, ".searchResultBlockButton", "Search UI includes dedicated block button styling", failures);

  // Result limit: capped at 50
  assertContains(catalogDataSource, "LIMIT 50", "searchCatalog caps video results to 50 per query", failures);

  // Suggestion routing invariants: track shortcuts go directly to selected video.
  assertContains(catalogDataSource, "SELECT videoId, title", "suggestCatalog track query fetches videoId for direct navigation", failures);
  assertContains(catalogDataSource, "url: `/?v=${encodeURIComponent(r.videoId)}&resume=1`", "suggestCatalog track suggestions link directly to video playback", failures);

  // Keyboard semantics: Enter only shortcuts when a suggestion is explicitly highlighted.
  assertContains(shellDynamicSource, "if (isOpen && suggestions && activeSuggestionIdx >= 0) {", "Shell only shortcuts to suggestion when keyboard selection is active", failures);
  assertContains(shellDynamicSource, "router.push(`/search?q=${encodeURIComponent(searchValue.trim())}&v=${encodeURIComponent(currentVideo.id)}`);", "Shell Enter without active suggestion routes to search results", failures);

  // --- Admin video edit modal and button on search results ---
  assertContains(searchPageSource, 'import { isAdminIdentity } from "@/lib/admin-auth";', "Search page imports admin identity helper", failures);
  assertContains(searchPageSource, 'import { AdminVideoEditButton } from "@/components/admin-video-edit-button";', "Search page imports admin video edit button", failures);
  assertContains(searchPageSource, 'import { AdminVideoDeleteButton } from "@/components/admin-video-delete-button";', "Search page imports admin video delete button", failures);
  assertContains(searchPageSource, "const isAdminUser = Boolean(user && isAdminIdentity(user.id, user.email ?? \"\"));", "Search page computes admin status from user", failures);
  assertContains(searchPageSource, "<AdminVideoEditButton videoId={video.id} isAdmin={isAdminUser} />", "Search page renders admin edit button for each video", failures);
  assertContains(searchPageSource, "<AdminVideoDeleteButton videoId={video.id} title={video.title} isAdmin={isAdminUser} />", "Search page renders admin delete button for each video", failures);

  assertContains(adminVideoEditButtonSource, '"use client"', "Admin video edit button is a client component", failures);
  assertContains(adminVideoEditButtonSource, 'import { AdminVideoEditModal } from "@/components/admin-video-edit-modal"', "Admin edit button imports the modal", failures);
  assertContains(adminVideoEditButtonSource, "if (!isAdmin) {", "Admin edit button hides itself for non-admin users", failures);
  assertContains(adminVideoEditButtonSource, "className=\"top100CardAdminEditBtn searchResultAdminEditBtn\"", "Admin edit button uses admin edit button styling", failures);
  assertContains(adminVideoEditButtonSource, "onSaveComplete={handleSaveComplete}", "Admin edit button wires save callback for immediate card updates", failures);
  assertContains(adminVideoEditButtonSource, ".leaderboardMeta h3", "Admin edit button updates search card title after save", failures);
  assertContains(adminVideoEditButtonSource, ".artistInlineLink", "Admin edit button updates search card artist/channel text after save", failures);

  assertContains(adminVideoEditModalSource, '"use client"', "Admin video edit modal is a client component", failures);
  assertContains(adminVideoEditModalSource, "isOpen", "Admin edit modal controls visibility via isOpen prop", failures);
  assertContains(adminVideoEditModalSource, "videoId", "Admin edit modal receives videoId prop", failures);
  assertContains(adminVideoEditModalSource, 'fetchWithAuthRetry(`/api/admin/videos?q=${encodeURIComponent(videoId)}`', "Admin edit modal fetches video details from admin API with auth retry", failures);
  assertContains(adminVideoEditModalSource, 'method: "PATCH"', "Admin edit modal saves through PATCH /api/admin/videos", failures);
  assertContains(adminVideoEditModalSource, "adminEditTitle", "Admin edit modal allows editing title", failures);
  assertContains(adminVideoEditModalSource, "adminEditParsedArtist", "Admin edit modal allows editing parsed artist", failures);
  assertContains(adminVideoEditModalSource, "parsedTrack", "Admin edit modal allows editing parsed track", failures);
  assertContains(adminVideoEditModalSource, 'fetchWithAuthRetry("/api/admin/videos"', "Admin edit modal posts changes to admin videos API with auth retry", failures);
  assertContains(adminVideoEditModalSource, "createPortal", "Admin edit modal renders as portal to body", failures);

  assertContains(adminVideoDeleteButtonSource, '"use client"', "Admin video delete button is a client component", failures);
  assertContains(adminVideoDeleteButtonSource, "if (!isAdmin)", "Admin delete button hides itself for non-admin users", failures);
  assertContains(adminVideoDeleteButtonSource, "createPortal", "Admin delete button uses a proper confirmation modal", failures);
  assertContains(adminVideoDeleteButtonSource, 'method: "DELETE"', "Admin delete button calls DELETE /api/admin/videos", failures);
  assertContains(adminVideoDeleteButtonSource, "className=\"shareModalBackdrop\"", "Admin delete confirmation uses site modal backdrop styling", failures);
  assertContains(adminVideoDeleteButtonSource, "className=\"adminVideoEditButton adminVideoEditButtonPrimary\"", "Admin delete confirmation uses site primary button styling", failures);

  assertContains(globalCssSource, ".searchResultAdminEditBtn", "CSS includes admin edit button styling", failures);
  assertContains(globalCssSource, "top: 8px;", "Admin edit button is positioned on the top corner row", failures);
  assertContains(globalCssSource, "right: 40px;", "Admin edit button is positioned to the left of the block button", failures);
  assertContains(globalCssSource, ".searchResultAdminDeleteBtn", "CSS includes admin delete button styling", failures);

  if (failures.length > 0) {
    console.error("Search invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Search invariant check passed.");
}

main();
