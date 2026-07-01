#!/usr/bin/env node

// Domain: Core Experience
// Covers: queue resolution (via rule-pack), Watch Next rail rendering,
// current-video API pool + filler, and catalog data sourcing / classification.
// Player controls → verify-player-core-invariants.js
// Dock routing / categories / chat → verify-overlay-routing-invariants.js
// New videos / seen-toggle → verify-new-videos-invariants.js

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
  assertFileDoesNotExist,
  finishInvariantCheck,
} = require("./lib/test-harness");
const { applyQueueResolutionRulePack } = require("./invariants/rule-packs/queue-resolution-pack");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  shellDynamicRendering: path.join(ROOT, "apps/web/components/shell-dynamic-rendering.tsx"),
  queueTrackCardContent: path.join(ROOT, "apps/web/components/queue-track-card-content.tsx"),
  playlistTrackCardContent: path.join(ROOT, "apps/web/components/playlist-track-card-content.tsx"),
  favouritesGrid: path.join(ROOT, "apps/web/components/favourites-grid.tsx"),
  historyInfiniteList: path.join(ROOT, "apps/web/components/history-infinite-list.tsx"),
  leaderboardVideoLink: path.join(ROOT, "apps/web/components/leaderboard-video-link.tsx"),
  categoryBrowser: path.join(ROOT, "apps/web/components/category-new-artists-browser.tsx"),
  videoGenreLink: path.join(ROOT, "apps/web/components/video-genre-link.tsx"),
  videoGenreNavigation: path.join(ROOT, "apps/web/lib/video-genre-navigation.ts"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  currentVideoRouteService: path.join(ROOT, "apps/web/lib/current-video-route-service.ts"),
  analyticsRoute: path.join(ROOT, "apps/web/app/api/analytics/route.ts"),
  analyticsClient: path.join(ROOT, "apps/web/lib/analytics-client.ts"),
  cronRelatedBackfillRoute: path.join(ROOT, "apps/web/app/api/cron/related-backfill/route.ts"),
  suggestRoute: path.join(ROOT, "apps/web/app/api/videos/suggest/route.ts"),
  adminArtistDiscoverRoute: path.join(ROOT, "apps/web/app/api/admin/artists/discover/route.ts"),
  artistDiscovery: path.join(ROOT, "apps/web/lib/artist-discovery.ts"),
  playlistImportRoute: path.join(ROOT, "apps/web/app/api/playlists/import/route.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  catalogDataVideos: path.join(ROOT, "apps/web/lib/catalog-data-videos.ts"),
  catalogDataArtists: path.join(ROOT, "apps/web/lib/catalog-data-artists.ts"),
  catalogDataGenres: path.join(ROOT, "apps/web/lib/catalog-data-genres.ts"),
  catalogDataHidden: path.join(ROOT, "apps/web/lib/catalog-data-hidden.ts"),
  catalogDataHistory: path.join(ROOT, "apps/web/lib/catalog-data-history.ts"),
  catalogDataFavourites: path.join(ROOT, "apps/web/lib/catalog-data-favourites.ts"),
  catalogDataDb: path.join(ROOT, "apps/web/lib/catalog-data-db.ts"),
  catalogDataVideoIngestion: path.join(ROOT, "apps/web/lib/catalog-data-video-ingestion.ts"),
  metadataUtils: path.join(ROOT, "apps/web/lib/catalog-metadata-utils.ts"),
  boundedMap: path.join(ROOT, "apps/web/lib/bounded-map.ts"),
  runtimeBootstrap: path.join(ROOT, "apps/web/lib/runtime-bootstrap.ts"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  nextTrackDecisionHook: path.join(ROOT, "apps/web/hooks/use-next-track-decision.ts"),
  temporaryQueueControllerHook: path.join(ROOT, "apps/web/hooks/use-temporary-queue-controller.ts"),
  playerNextTrackDomain: path.join(ROOT, "apps/web/domains/player/resolve-next-track-target.ts"),
  queueDomain: path.join(ROOT, "apps/web/domains/queue/temporary-queue.ts"),
  playlistDomain: path.join(ROOT, "apps/web/domains/playlist/playlist-step-target.ts"),
  playerEvents: path.join(ROOT, "apps/web/lib/player-events.ts"),
  relatedBackfillScript: path.join(ROOT, "scripts/backfill-related-links.js"),
  catalogIntegrityAuditScript: path.join(ROOT, "scripts/audit-catalog-integrity.js"),
};

function main() {
  const failures = [];

  const shellDynamicSource = [
    readFileStrict(files.shellDynamic, ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-chat-state.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-playlist-rail.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-performance-metrics.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-desktop-intro.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/hooks/use-search-autocomplete.ts'), ROOT),
  ].join('\n');
  const shellDynamicRenderingSource = readFileStrict(files.shellDynamicRendering, ROOT);
  const queueTrackCardContentSource = readFileStrict(files.queueTrackCardContent, ROOT);
  const playlistTrackCardContentSource = readFileStrict(files.playlistTrackCardContent, ROOT);
  const favouritesGridSource = readFileStrict(files.favouritesGrid, ROOT);
  const historyInfiniteListSource = readFileStrict(files.historyInfiniteList, ROOT);
  const leaderboardVideoLinkSource = readFileStrict(files.leaderboardVideoLink, ROOT);
  const categoryBrowserSource = readFileStrict(files.categoryBrowser, ROOT);
  const videoGenreLinkSource = readFileStrict(files.videoGenreLink, ROOT);
  const videoGenreNavigationSource = readFileStrict(files.videoGenreNavigation, ROOT);
  const shellRenderingSource = `${shellDynamicSource}\n${shellDynamicRenderingSource}`;
  const currentVideoRouteServiceSource = readFileStrict(files.currentVideoRouteService, ROOT);
  const currentVideoRouteSource = [
    readFileStrict(files.currentVideoRoute, ROOT),
    currentVideoRouteServiceSource,
  ].join('\n');
  const analyticsRouteSource = readFileStrict(files.analyticsRoute, ROOT);
  const analyticsClientSource = readFileStrict(files.analyticsClient, ROOT);
  const cronRelatedBackfillRouteSource = readFileStrict(files.cronRelatedBackfillRoute, ROOT);
  const suggestRouteSource = readFileStrict(files.suggestRoute, ROOT);
  const adminArtistDiscoverRouteSource = readFileStrict(files.adminArtistDiscoverRoute, ROOT);
  const artistDiscoverySource = readFileStrict(files.artistDiscovery, ROOT);
  const playlistImportRouteSource = readFileStrict(files.playlistImportRoute, ROOT);
  const catalogDataSource = readFileStrict(files.catalogData, ROOT);
  const catalogDataVideosSource = readFileStrict(files.catalogDataVideos, ROOT);
  const catalogDataArtistsSource = [
    readFileStrict(files.catalogDataArtists, ROOT),
    readFileStrict(path.join(ROOT, "apps/web/lib/artist-constants.ts"), ROOT),
  ].join('\n');
  const catalogDataGenresSource = [
    readFileStrict(files.catalogDataGenres, ROOT),
    readFileStrict(path.join(ROOT, "apps/web/lib/genre-constants.ts"), ROOT),
  ].join('\n');
  const catalogDataHiddenSource = readFileStrict(files.catalogDataHidden, ROOT);
  const catalogDataHistorySource = readFileStrict(files.catalogDataHistory, ROOT);
  const catalogDataFavouritesSource = readFileStrict(files.catalogDataFavourites, ROOT);
  const catalogDataDbSource = readFileStrict(files.catalogDataDb, ROOT);
  const catalogDataVideoIngestionSource = [
    readFileStrict(files.catalogDataVideoIngestion, ROOT),
    readFileStrict(path.join(ROOT, "apps/web/lib/video-ingestion-constants.ts"), ROOT),
  ].join('\n');
  const metadataUtilsSource = readFileStrict(files.metadataUtils, ROOT);
  const boundedMapSource = readFileStrict(files.boundedMap, ROOT);
  const runtimeBootstrapSource = readFileStrict(files.runtimeBootstrap, ROOT);
  const classificationSource = `${catalogDataSource}\n${metadataUtilsSource}`;
  const playerExperienceSource = readFileStrict(files.playerExperience, ROOT);
  const nextTrackDecisionHookSource = readFileStrict(files.nextTrackDecisionHook, ROOT);
  const temporaryQueueControllerHookSource = readFileStrict(files.temporaryQueueControllerHook, ROOT);
  const playerNextTrackDomainSource = readFileStrict(files.playerNextTrackDomain, ROOT);
  const queueDomainSource = readFileStrict(files.queueDomain, ROOT);
  const playlistDomainSource = readFileStrict(files.playlistDomain, ROOT);
  const playerEventsSource = readFileStrict(files.playerEvents, ROOT);
  const relatedBackfillScriptSource = readFileStrict(files.relatedBackfillScript, ROOT);
  const catalogIntegrityAuditScriptSource = readFileStrict(files.catalogIntegrityAuditScript, ROOT);

  applyQueueResolutionRulePack({
    shellDynamicSource,
    playerExperienceSource,
    temporaryQueueControllerHookSource,
    nextTrackDecisionHookSource,
    playerNextTrackDomainSource,
    queueDomainSource,
    playlistDomainSource,
    playerEventsSource,
    assertContains,
    failures,
  });

  // Watch Next rail rendering invariants.
  assertContains(shellDynamicSource, "<div className=\"railTabs rightRailTabs\">", "Shell renders right rail tabs container", failures);
  assertContains(shellDynamicSource, "Watch Next", "Shell labels a right rail tab as Watch Next", failures);
  assertContains(shellDynamicSource, "Playlist", "Shell labels a right rail tab as Playlist", failures);
  assertContains(shellDynamicSource, "const [relatedTransitionPhase, setRelatedTransitionPhase] = useState<\"idle\" | \"fading-out\" | \"loading\" | \"fading-in\">(\"idle\");", "Watch Next uses explicit transition phases", failures);
  assertContains(shellDynamicSource, "seenVideoIdsRef.current = new Set<string>();", "Shell clears stale seen ids when auth is lost", failures);
  assertContains(shellDynamicSource, "if (!isAuthenticated) {", "Shell ignores watch-history seen updates while logged out", failures);
  assertContains(shellDynamicSource, "isSeen={isAuthenticated && seenVideoIdsRef.current.has(track.id)}", "Shell only renders watch-next seen badges for authenticated users", failures);
  assertContains(shellRenderingSource, "{isSeen && !isFavourite ? <span className=\"videoSeenBadge videoSeenBadgeOverlay relatedSeenBadgeOverlay\">Seen</span> : null}", "Watch Next suppresses seen badge when favourite heart is present", failures);
  assertNotContains(shellDynamicSource, "{isSeen ? <span className=\"videoSeenBadge videoSeenBadgeOverlay relatedSeenBadgeOverlay\">Seen</span> : null}", "Watch Next should not render seen badge for favourited cards", failures);
  assertContains(shellDynamicSource, "watchNextRailRef.current.scrollTop = 0;", "Watch Next resets scroll top during transition", failures);
  assertContains(queueTrackCardContentSource, "const parsedTrackCandidate = (() => {", "Queue cards derive a parsed-track fallback when parsedTrack is missing", failures);
  assertContains(queueTrackCardContentSource, "const strippedRemainder = remainder.replace(/^[\\-:\\u2013\\u2014\\|]+\\s*/, \"\").trim();", "Queue cards strip artist-prefix separators from title fallback track text", failures);
  assertContains(queueTrackCardContentSource, "const hasParsedTitlePattern = Boolean(parsedArtistCandidate && parsedTrackLabel);", "Queue cards only enter parsed-title mode with both artist and track labels", failures);
  assertContains(queueTrackCardContentSource, "<span aria-hidden=\"true\"> - </span>", "Queue cards render ARTIST - Track separator in title", failures);
  assertContains(queueTrackCardContentSource, "<VideoGenreLink genre={genreLabel} stopPropagation nestedInLink />", "Queue cards render genre labels as category deep links", failures);
  assertContains(playlistTrackCardContentSource, "<VideoGenreLink genre={genreLabel} stopPropagation nestedInLink />", "Playlist cards render genre labels as category deep links", failures);
  assertContains(favouritesGridSource, "<VideoGenreLink genre={genreLabel} stopPropagation />", "Favourites grid renders genre labels as category deep links", failures);
  assertContains(historyInfiniteListSource, "<VideoGenreLink genre={entry.video.genre} />", "History cards render genre labels as category deep links", failures);
  assertContains(leaderboardVideoLinkSource, "<VideoGenreLink genre={categoryLabel} stopPropagation />", "Leaderboard cards render genre labels as category deep links", failures);
  assertContains(playerExperienceSource, "<VideoGenreLink genre={overlayGenreLabel} />", "Player overlay renders genre labels as category deep links", failures);
  assertContains(videoGenreLinkSource, "resolveVideoGenreNavigationTarget", "Video genre link component uses shared genre navigation target resolver", failures);
  assertContains(videoGenreNavigationSource, "resolveVideoGenreNavigationTarget", "Video genre navigation helper exposes resolver", failures);
  assertContains(videoGenreNavigationSource, "`/categories/${categorySlug}?tab=${encodeURIComponent(tabId)}`", "Video genre navigation includes category tab query when a specific tab is resolved", failures);
  assertContains(categoryBrowserSource, "writeCategoryArtistsTab(slug, tab.id);", "Category browser persists selected category tab in session state", failures);
  assertContains(categoryBrowserSource, "CATEGORY_ARTISTS_TAB_EVENT", "Category browser synchronizes tab selection updates across overlays", failures);

  // Current-video API invariants.
  assertContains(currentVideoRouteSource, "RESOLVE_CURRENT_VIDEO_TARGET_RELATED_COUNT = 8;", "Current-video API targets 8 Watch Next items", failures);
  assertContains(currentVideoRouteSource, "earlyTopVideosForPadding ?? await ", "Current-video API fetches bounded filler pool (parallel-prefetched or direct)", failures);
  assertContains(currentVideoRouteSource, "const filler = shuffleVideos(fillerPool).slice(0, ", "Current-video API randomizes sparse filler selection", failures);
  assertContains(currentVideoRouteSource, "process.env.CURRENT_VIDEO_MAX_CONCURRENT_RESOLVERS", "Current-video API exposes configurable resolver concurrency for traffic spikes", failures);
  assertContains(currentVideoRouteSource, "pendingReason?: \"cooldown\" | \"concurrency-shed\" | \"timeout\" | \"resolver-error\"", "Current-video pending payload includes explicit overload reason metadata", failures);
  assertContains(currentVideoRouteSource, "retryAfterMs", "Current-video pending payload provides retry-after hint for client pacing", failures);
  assertNotContains(currentVideoRouteServiceSource, 'from "next/server"', "Current-video route service is free of HTTP-layer imports (next/server)", failures);
  assertNotContains(currentVideoRouteServiceSource, "NextResponse", "Current-video route service does not construct HTTP responses", failures);

  // Analytics API invariants.
  assertContains(analyticsRouteSource, 'import { parseRequestJson } from "@/lib/request-json";', "Analytics API uses shared JSON parser helper", failures);
  assertContains(analyticsRouteSource, "const bodyResult = await parseRequestJson<unknown>(request);", "Analytics API parses request body via shared helper", failures);
  assertContains(analyticsRouteSource, "if (!bodyResult.ok) {", "Analytics API handles shared parser failure path", failures);
  assertContains(analyticsRouteSource, "return NextResponse.json({ ok: false }, { status: 400 });", "Analytics API preserves stable invalid-body response contract", failures);

  // Analytics client UUID invariants.
  assertContains(analyticsClientSource, "crypto.randomUUID()", "Analytics client uses crypto.randomUUID() for visitor/session ID generation", failures);
  assertNotContains(analyticsClientSource, "uuidV4", "Analytics client does not use a custom Math.random-based UUID implementation", failures);
  assertNotContains(analyticsClientSource, "Math.random", "Analytics client does not use Math.random for ID generation", failures);

  // Cache-bound invariants.
  assertContains(boundedMapSource, "export class BoundedMap", "BoundedMap utility exports a bounded map class", failures);
  assertContains(catalogDataVideosSource, "const VIDEO_CACHE_MAX_ENTRIES =", "Core video catalog defines bounded cache capacity", failures);
  assertContains(catalogDataVideosSource, "const newestVideosRequestCache = new BoundedMap", "Core video catalog bounds newest request cache", failures);
  assertContains(catalogDataVideosSource, "const relatedVideosCache = new BoundedMap", "Core video catalog bounds related videos cache", failures);
  assertContains(catalogDataVideosSource, "const suggestCacheMap = new BoundedMap", "Core video catalog bounds suggest cache", failures);
  assertContains(catalogDataArtistsSource, "const ARTIST_CACHE_MAX_ENTRIES =", "Artist catalog defines bounded cache capacity", failures);
  assertContains(catalogDataArtistsSource, "const artistSearchCache = new BoundedMap", "Artist catalog bounds search cache", failures);
  assertContains(catalogDataGenresSource, "const GENRE_CACHE_MAX_ENTRIES =", "Genre catalog defines bounded cache capacity", failures);
  assertContains(catalogDataGenresSource, "const genreVideosCache = new BoundedMap", "Genre catalog bounds videos cache", failures);
  assertContains(catalogDataHiddenSource, "const hiddenVideoIdsCache = new BoundedMap", "Hidden catalog bounds hidden-id cache", failures);
  assertContains(catalogDataHistorySource, "const seenVideoIdsInFlight = new BoundedMap", "History catalog bounds in-flight seen cache", failures);
  assertContains(catalogDataFavouritesSource, "const favouriteVideosInFlight = new BoundedMap", "Favourites catalog bounds in-flight favourites cache", failures);
  assertContains(catalogDataDbSource, "const tableColumnsCache = new BoundedMap", "Catalog DB schema helper bounds table-column cache", failures);
  assertContains(catalogDataDbSource, "NULLIF(TRIM(v.parsedTrack), '') AS parsedTrack,", "Catalog DB fast video lookup selects parsedTrack for refresh-stable display metadata", failures);
  assertContains(catalogDataVideoIngestionSource, "const rejectedVideoCache = new BoundedMap", "Video ingestion bounds rejected-video cache", failures);

  // Runtime bootstrap patching invariants.
  assertContains(runtimeBootstrapSource, "export function applyRuntimeBootstrapPatches", "Runtime bootstrap utility exposes explicit patch opt-in entrypoint", failures);
  assertContains(runtimeBootstrapSource, "export function enableSafePerformanceMeasurePatch", "Runtime bootstrap utility exposes dedicated performance.measure patch helper", failures);
  assertContains(shellDynamicSource, 'import { applyRuntimeBootstrapPatches } from "@/lib/runtime-bootstrap";', "Shell imports centralized runtime bootstrap patch helper", failures);
  assertContains(shellDynamicSource, "applyRuntimeBootstrapPatches({ safePerformanceMeasure: true });", "Shell explicitly opts into safe performance.measure patch", failures);
  assertNotContains(shellDynamicSource, "__ytrMeasurePatched", "Shell no longer keeps local performance patch state flags", failures);
  assertNotContains(shellDynamicSource, "performance.measure =", "Shell no longer monkey-patches performance.measure inline", failures);

  // Cron related-backfill API invariants.
  assertContains(cronRelatedBackfillRouteSource, "const CRON_SECRET = process.env.CRON_SECRET?.trim() || \"\";", "Cron related-backfill route resolves CRON_SECRET from environment", failures);
  assertContains(cronRelatedBackfillRouteSource, "function isCronAuthorized(request: NextRequest): boolean", "Cron related-backfill route defines explicit authorization guard", failures);
  assertContains(cronRelatedBackfillRouteSource, "const auth = request.headers.get(\"authorization\") ?? \"\";", "Cron related-backfill route reads Authorization header", failures);
  assertContains(cronRelatedBackfillRouteSource, "const token = auth.startsWith(\"Bearer \") ? auth.slice(7).trim() : \"\";", "Cron related-backfill route parses bearer token", failures);
  assertContains(cronRelatedBackfillRouteSource, "return token.length > 0 && token === CRON_SECRET;", "Cron related-backfill route requires bearer token to match CRON_SECRET", failures);
  assertContains(cronRelatedBackfillRouteSource, "if (!isCronAuthorized(request)) {", "Cron related-backfill route rejects unauthorized requests early", failures);
  assertContains(cronRelatedBackfillRouteSource, "return NextResponse.json({ error: \"Unauthorized.\" }, { status: HTTP_UNAUTHORIZED });", "Cron related-backfill route returns stable unauthorized response contract", failures);

  // Automated video discovery is enabled but must remain hard-capped and policy-gated.
  assertContains(catalogDataVideoIngestionSource, "const ENABLE_AUTOMATED_TRACK_DISCOVERY: boolean = true;", "Video ingestion enables automated track discovery", failures);
  assertContains(catalogDataVideoIngestionSource, "const RELATED_DISCOVERY_DAILY_NEW_VIDEO_CAP = Math.max(0, Math.min(50, Number(process.env.RELATED_DISCOVERY_DAILY_NEW_VIDEO_CAP || \"50\")));", "Video ingestion enforces a hard 50/day maximum cap for related discovery admissions", failures);
  assertContains(catalogDataVideoIngestionSource, "const AUTOMATED_TRACK_DISCOVERY_DISABLED_REASON = \"manual-submissions-only\";", "Video ingestion records the manual-submissions-only disabled reason", failures);
  assertContains(catalogDataVideoIngestionSource, "function canRunAutomatedTrackDiscovery(): boolean", "Video ingestion centralizes the automated discovery gate", failures);
  assertContains(catalogDataVideoIngestionSource, "fetchRelatedYouTubeVideos:disabled", "Related YouTube fetches fail closed while automated discovery is disabled", failures);
  assertContains(catalogDataVideoIngestionSource, "discoverRelatedVideosCascade:disabled", "Related cascade fails closed while automated discovery is disabled", failures);
  assertContains(catalogDataVideoIngestionSource, "runQuotaBackfill:disabled", "Quota backfill fails closed while automated discovery is disabled", failures);
  assertContains(catalogDataVideoIngestionSource, "auto-related-backfill:disabled", "Automatic related backfill scheduler is a no-op", failures);
  assertContains(catalogDataVideoIngestionSource, "Direct playback of an unknown YouTube id must not create pending review rows.", "Unknown direct playback does not create pending review rows", failures);
  assertContains(catalogDataVideoIngestionSource, "getVideoPlaybackDecision:direct-ingest-disabled", "Playback decision logs when unknown direct ingestion is denied", failures);
  assertContains(catalogDataVideoIngestionSource, "const shouldDiscoverRelated = canRunAutomatedTrackDiscovery() && options?.discoverRelated === true && !existedBeforeImport;", "Direct ingestion cannot discover related videos unless the hard gate is enabled", failures);
  assertNotContains(catalogDataVideoIngestionSource, "const hydrated = await hydrateAndPersistVideo(normalizedVideoId);", "Playback decision must not hydrate unknown direct video ids", failures);
  assertNotContains(catalogDataVideoIngestionSource, "autoRelatedBackfillTimer = setTimeout", "Automatic related backfill must not schedule timers", failures);
  assertNotContains(catalogDataVideoIngestionSource, "auto-related-backfill:scheduled", "Automatic related backfill must not expose a scheduled path", failures);
  assertNotContains(catalogDataVideoIngestionSource, "ENABLE_AUTO_RELATED_BACKFILL", "Env flags must not be able to re-enable automatic related backfill", failures);
  assertContains(cronRelatedBackfillRouteSource, "const DISABLED_REASON = \"disabled-manual-submissions-only\";", "Cron related-backfill route returns a stable disabled reason", failures);
  assertNotContains(cronRelatedBackfillRouteSource, "runQuotaBackfill", "Cron related-backfill route must not call quota backfill", failures);
  assertNotContains(cronRelatedBackfillRouteSource, "hasDatabaseUrl", "Cron related-backfill route must return disabled without touching the database", failures);
  assertContains(relatedBackfillScriptSource, "const FORCE_RELATED_BACKFILL_FLAG = \"--force-related-backfill\";", "Standalone related backfill requires an explicit force flag", failures);
  assertContains(relatedBackfillScriptSource, "reason: \"disabled-manual-submissions-only\"", "Standalone related backfill reports the disabled reason by default", failures);
  assertContains(relatedBackfillScriptSource, "process.exit(0);", "Standalone related backfill exits successfully before external calls when disabled", failures);
  assertContains(catalogIntegrityAuditScriptSource, "relatedBackfill: \"disabled-manual-submissions-only\"", "Catalog integrity audit no longer recommends related backfill as remediation", failures);
  assertNotContains(catalogIntegrityAuditScriptSource, "npm run backfill:related -- --max-calls", "Catalog integrity audit must not recommend the disabled related backfill command", failures);
  assertContains(suggestRouteSource, "const discoverRelatedForSuggestion = false;", "Suggest-new direct submissions do not trigger related discovery", failures);
  assertContains(suggestRouteSource, "const SUGGEST_SIGN_IN_REQUIRED_MESSAGE = \"Sign in to suggest new videos.\";", "Suggest-new requires a signed-in user before ingestion", failures);
  assertContains(suggestRouteSource, "rateLimitOrResponse(", "Suggest-new applies an IP-scoped emergency rate limit", failures);
  assertContains(suggestRouteSource, "`videos:suggest:${source.kind}:user:${authenticatedUserId}`", "Suggest-new applies a user-scoped emergency rate limit", failures);
  assertContains(suggestRouteSource, "discoverRelated: false", "Suggest-new playlist/channel batch ingestion does not trigger related discovery", failures);
  assertContains(playlistImportRouteSource, "importVideoFromDirectSource(videoId, { discoverRelated: false });", "Playlist ingestion remains a user submission path without related discovery", failures);
  assertContains(adminArtistDiscoverRouteSource, "discoverTracksForArtist", "Admin artist discovery delegates to the guarded shared discoverTracksForArtist helper", failures);
  assertContains(artistDiscoverySource, "discoverRelated: false", "Artist discovery helper blocks cascading related discovery", failures);

  // Catalog data support invariants for fallback sourcing.
  assertContains(catalogDataVideosSource, "const rankedVideoIds = Array.from(new Set(rankedVideoIdRows.map((row) => row.videoId).filter(Boolean))).slice(0, fetchLimit);", "Ranked top-pool builder deduplicates candidate video ids before hydration", failures);
  assertContains(catalogDataVideosSource, "WHERE v.videoId IN (${placeholders})", "Ranked top-pool builder hydrates rows using candidate id IN filter", failures);
  assertContains(catalogDataVideosSource, "ORDER BY FIELD(v.videoId, ${placeholders})", "Ranked top-pool hydration preserves candidate ordering using FIELD", failures);
  assertContains(catalogDataSource, "export async function getUnseenCatalogVideos(options?: {", "Catalog data exposes unseen catalog helper", failures);
  assertContains(catalogDataSource, "const requested = Math.max(1, Math.min(500, Math.floor(options?.count ?? 100)));", "Unseen catalog helper validates and clamps requested count", failures);
  assertContains(catalogDataSource, "const useSharedRelatedCache = excludedIds.size === 0;", "Related videos cache is reused for any exclude-free request size", failures);
  assertContains(catalogDataSource, "if (cached && cached.expiresAt > now && cached.videos.length >= requestedCount)", "Related videos cache serves larger pooled recommendation requests", failures);
  assertContains(catalogDataSource, "const newestPromise = getNewestVideos(50).then((videos) =>", "Related videos reuse newest helper instead of issuing a duplicate newest scan", failures);
  assertContains(catalogDataSource, "if (await isRejectedVideo(normalizedVideoId)) {", "Hydration path fast-exits for rejected videos before external API calls", failures);
  assertContains(catalogDataSource, "await persistRejectedVideo(video.id, availability.reason || \"unavailable\");", "Unavailable videos are persisted into rejected video blocklist", failures);
  assertContains(catalogDataSource, "SELECT video_id FROM rejected_videos WHERE video_id IN", "Existing-catalog check includes rejected video ids", failures);
  assertContains(catalogDataSource, "if (reason === \"admin-hard-delete\") {", "Hard-delete path applies admin-specific reject blocklist handling", failures);
  assertContains(catalogDataSource, "VALUES (${normalizedVideoId}, ${\"admin-deleted\"}, ${new Date()})", "Admin hard-delete writes admin-deleted reason to rejected table", failures);
  assertContains(catalogDataSource, "ORDER BY v.created_at DESC, v.id DESC", "Newest ranking is anchored on created_at then id", failures);
  assertContains(catalogDataSource, "ORDER BY COALESCE(v.updatedAt, v.createdAt) DESC, v.id DESC", "Newest logic retains explicit legacy timestamp fallback path", failures);
  assertContains(catalogDataSource, "const admissionDecision = admissionRow ? evaluatePlaybackMetadataEligibility(admissionRow) : null;", "Related cascade evaluates metadata eligibility before admitting discovered videos", failures);
  assertContains(catalogDataSource, "!admissionRow || !Boolean(admissionRow.hasAvailable) || !admissionDecision?.allowed", "Related cascade requires available embed + metadata eligibility", failures);
  assertContains(catalogDataSource, "await pruneVideoAndAssociationsByVideoId(candidate.id, \"related-cascade-strict-admission\").catch(() => undefined);", "Related cascade prunes candidates that fail strict admission", failures);
  assertContains(catalogDataSource, "const ROCK_METAL_GENRE_PATTERN =", "Catalog classifier defines explicit rock/metal genre evidence pattern", failures);
  assertContains(classificationSource, "function computeArtistChannelConfidenceDelta", "Catalog classifier computes artist/channel consistency confidence delta", failures);
  assertContains(catalogDataSource, "const artistEvidence = correctedArtist", "Runtime metadata persistence derives internal artist evidence for confidence tuning", failures);
  assertContains(catalogDataSource, "Known artist lacks strong rock/metal genre evidence.", "Runtime metadata persistence penalizes known artists without rock/metal evidence", failures);
  assertContains(catalogDataSource, "Artist token matched channel title.", "Runtime metadata persistence boosts confidence when channel and artist align", failures);
  assertContains(catalogDataSource, "if (isLikelyNonMusicText(video.title, video.description ?? \"\"))", "Runtime metadata persistence applies non-music confidence dampening", failures);
  assertContains(catalogDataSource, "const mojibakeScore = scoreLikelyMojibake(video.title);", "Runtime metadata persistence uses mojibake score to dampen confidence", failures);
  assertContains(catalogDataSource, "YehThatRocks is a rock/metal catalog.", "Groq metadata prompt encodes rock/metal-only extraction intent", failures);

  // Shell architecture invariants: the live shell must be shell-dynamic-core.tsx; the legacy app-shell.tsx must not exist.
  assertFileDoesNotExist(path.join(ROOT, "apps/web/components/app-shell.tsx"), "Legacy app-shell.tsx is not present (live shell is shell-dynamic-core.tsx)", failures, ROOT);

  finishInvariantCheck({
    failures,
    failureHeader: "Core experience invariant check failed.",
    successMessage: "Core experience invariant check passed.",
  });
}

main();
