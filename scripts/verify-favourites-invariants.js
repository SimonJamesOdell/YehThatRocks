#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  favouritesPage: path.join(ROOT, "apps/web/app/(shell)/favourites/page.tsx"),
  favouritesGrid: path.join(ROOT, "apps/web/components/favourites-grid.tsx"),
  favouritesManager: path.join(ROOT, "apps/web/components/favourites-manager.tsx"),
  searchResultFavouriteButton: path.join(ROOT, "apps/web/components/search-result-favourite-button.tsx"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  clientAuthFetch: path.join(ROOT, "apps/web/lib/client-auth-fetch.ts"),
  favouritesRoute: path.join(ROOT, "apps/web/app/api/favourites/route.ts"),
  userProfilePage: path.join(ROOT, "apps/web/app/(shell)/u/[screenName]/page.tsx"),
  userProfilePanel: path.join(ROOT, "apps/web/components/user-profile-panel.tsx"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  appRoot: path.join(ROOT, "apps/web/app"),
};

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

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

  const favouritesPageSource = read(files.favouritesPage);
  const favouritesGridSource = read(files.favouritesGrid);
  const favouritesManagerSource = read(files.favouritesManager);
  const searchResultFavouriteButtonSource = read(files.searchResultFavouriteButton);
  const playerExperienceSource = read(files.playerExperience);
  const clientAuthFetchSource = read(files.clientAuthFetch);
  const favouritesRouteSource = read(files.favouritesRoute);
  const userProfilePageSource = read(files.userProfilePage);
  const userProfilePanelSource = read(files.userProfilePanel);
  const apiSchemasSource = read(files.apiSchemas);
  const globalCssSource = collectCssFiles(files.appRoot)
    .map((filePath) => read(filePath))
    .join("\n");

  // --- Favourites page: server-side auth and data loading ---
  assertContains(favouritesPageSource, "getCurrentAuthenticatedUser", "Favourites page resolves current authenticated user server-side", failures);
  assertContains(favouritesPageSource, "getFavouriteVideos(user.id)", "Favourites page loads favourites for authenticated user only", failures);
  assertContains(favouritesPageSource, "user ? await getFavouriteVideos(user.id) : []", "Favourites page returns empty array for unauthenticated visitors", failures);
  assertContains(favouritesPageSource, "const initialFavourites = favourites.slice(0, FAVOURITES_BATCH_SIZE)", "Favourites page slices server favourites for paginated initial batch", failures);
  assertContains(favouritesPageSource, "const totalCount = favourites.length", "Favourites page computes favourites total count for header", failures);
  assertContains(favouritesPageSource, "<FavouritesGrid", "Favourites page renders FavouritesGrid component", failures);
  assertContains(favouritesPageSource, "isAuthenticated={hasAccessToken}", "Favourites page passes auth state to FavouritesGrid", failures);
  assertContains(favouritesPageSource, "initialFavourites={initialFavourites}", "Favourites page passes initial paginated favourites to FavouritesGrid", failures);
  assertContains(favouritesPageSource, "initialTotalCount={totalCount}", "Favourites page passes favourites total count to FavouritesGrid", failures);
  assertContains(favouritesPageSource, "initialHasMore={totalCount > initialFavourites.length}", "Favourites page passes initial hasMore to FavouritesGrid", failures);
  assertNotContains(favouritesPageSource, "getSeenVideoIdsForUser", "Own favourites page does not fetch seen ids", failures);
  assertNotContains(favouritesPageSource, "seenVideoIds={", "Own favourites page does not pass seen ids into favourites grid", failures);

  // --- FavouritesGrid: client-side refresh and event handling ---
  assertContains(favouritesGridSource, "EVENT_NAMES.FAVOURITES_UPDATED", "FavouritesGrid listens for ytr:favourites-updated refresh event", failures);
  assertContains(favouritesGridSource, "listenToAppEvent(EVENT_NAMES.FAVOURITES_UPDATED", "FavouritesGrid subscribes to favourites updated event", failures);
  assertNotContains(favouritesGridSource, "window.removeEventListener(\"ytr:favourites-updated\"", "FavouritesGrid unsubscribes from favourites updated event on cleanup", failures);
  assertContains(favouritesGridSource, "pathname !== \"/favourites\"", "FavouritesGrid only refreshes when on the favourites page", failures);
  assertContains(favouritesGridSource, "cache: \"no-store\"", "FavouritesGrid refreshes with no-store to bypass cache", failures);

  // --- FavouritesGrid: optimistic removal ---
  assertContains(favouritesGridSource, "setFavourites((current) => current.filter((track) => track.id !== videoId))", "FavouritesGrid removes track from local state optimistically", failures);
  assertContains(favouritesGridSource, "action: \"remove\"", "FavouritesGrid sends remove action to favourites API", failures);
  assertContains(favouritesGridSource, 'import { ArtistWikiLink } from "@/components/artist-wiki-link";', "FavouritesGrid imports artist wiki link helper", failures);
  assertContains(favouritesGridSource, '<ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">', "FavouritesGrid wraps artist names with wiki links", failures);
  assertContains(favouritesGridSource, "relatedSourceBadge relatedSourceBadgeTop100", "FavouritesGrid renders Top100 source badges", failures);
  assertContains(favouritesGridSource, "relatedSourceBadge relatedSourceBadgeNew", "FavouritesGrid renders New source badges", failures);
  assertNotContains(favouritesGridSource, "videoSeenBadge", "Own favourites grid does not render seen badges", failures);

  // --- FavouritesGrid: auth-gated error handling ---
  assertContains(favouritesGridSource, "response.status === 401 || response.status === 403", "FavouritesGrid handles 401/403 from favourites API gracefully", failures);
  assertContains(favouritesGridSource, "Sign in to manage favourites", "FavouritesGrid shows sign-in prompt for unauthenticated actions", failures);

  // --- Client auth retry for favourites mutations ---
  assertContains(clientAuthFetchSource, "export async function fetchWithAuthRetry", "Client auth helper exports fetchWithAuthRetry", failures);
  assertContains(clientAuthFetchSource, "const response = await fetch(\"/api/auth/refresh\"", "Client auth helper calls refresh endpoint when needed", failures);
  assertContains(clientAuthFetchSource, "if (response.status !== 401 && response.status !== 403)", "Client auth helper only retries on 401/403", failures);
  assertContains(clientAuthFetchSource, "if (isRefreshEndpoint(input))", "Client auth helper avoids retry loops on refresh endpoint", failures);
  assertContains(clientAuthFetchSource, "response = await fetch(input, requestInit);", "Client auth helper retries original request after refresh", failures);
  assertContains(favouritesGridSource, 'import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";', "FavouritesGrid uses auth-retry helper", failures);
  assertContains(favouritesGridSource, 'await fetchWithAuthRetry("/api/favourites"', "FavouritesGrid favourites fetches use auth-retry helper", failures);
  assertContains(favouritesManagerSource, 'import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";', "FavouritesManager uses auth-retry helper", failures);
  assertContains(favouritesManagerSource, 'await fetchWithAuthRetry("/api/favourites"', "FavouritesManager favourite updates use auth-retry helper", failures);
  assertContains(searchResultFavouriteButtonSource, 'import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";', "Search result favourite button uses auth-retry helper", failures);
  assertContains(searchResultFavouriteButtonSource, 'await fetchWithAuthRetry("/api/favourites"', "Search result favourite add uses auth-retry helper", failures);
  assertContains(playerExperienceSource, 'import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";', "PlayerExperience uses auth-retry helper for favourites", failures);
  assertContains(playerExperienceSource, 'const favouritesResponse = await fetchWithAuthRetry("/api/favourites"', "PlayerExperience favourites autoplay fetch uses auth-retry helper", failures);
  assertContains(playerExperienceSource, 'const response = await fetchWithAuthRetry("/api/favourites"', "PlayerExperience add favourite uses auth-retry helper", failures);

  // --- FavouritesGrid: accessibility ---
  assertContains(favouritesGridSource, "aria-label={`Remove ${track.title} from favourites`}", "FavouritesGrid remove button has descriptive aria-label", failures);
  assertContains(favouritesGridSource, "disabled={!isAuthenticated || isPending || isRemoving || isCreatingPlaylistFromFavourites}", "FavouritesGrid remove button is disabled while mutations or playlist creation are in-flight", failures);

  // --- FavouritesGrid: empty state ---
  assertContains(favouritesGridSource, "favouritesEmptyState", "FavouritesGrid renders empty state container", failures);
  assertContains(favouritesGridSource, "role=\"status\"", "FavouritesGrid empty state has role=status for screen readers", failures);
  assertContains(favouritesGridSource, "aria-live=\"polite\"", "FavouritesGrid empty state uses aria-live=polite", failures);

  // --- Favourites API route: authentication ---
  assertContains(favouritesRouteSource, "requireApiAuth(request)", "Favourites GET route requires authenticated session", failures);
  assertContains(favouritesRouteSource, "export async function GET", "Favourites route exports GET handler", failures);
  assertContains(favouritesRouteSource, "export async function POST", "Favourites route exports POST handler for mutations", failures);

  // --- Favourites API route: CSRF and validation ---
  assertContains(favouritesRouteSource, "verifySameOrigin(request)", "Favourites POST route enforces same-origin CSRF check", failures);
  assertContains(favouritesRouteSource, "favouriteMutationSchema.safeParse(bodyResult.data)", "Favourites POST validates body against favouriteMutationSchema", failures);
  assertContains(favouritesRouteSource, "updateFavourite(parsed.data.videoId, parsed.data.action, authResult.auth.userId)", "Favourites POST delegates to updateFavourite with correct arguments", failures);

  // --- Public user profile favourites/playlist-detail parity ---
  assertContains(userProfilePageSource, "getSeenVideoIdsForUser(viewer.id)", "User profile page resolves viewer seen ids for public listings", failures);
  assertContains(userProfilePageSource, "seenVideoIds={Array.from(seenVideoIds)}", "User profile page passes seen ids into panel", failures);
  assertContains(userProfilePageSource, "isAuthenticated={hasAccessToken}", "User profile page passes auth state into panel", failures);
  assertContains(userProfilePanelSource, "seenVideoIds?: string[];", "User profile panel accepts seen ids for listing badges", failures);
  assertContains(userProfilePanelSource, "tab === \"playlist-detail\"", "User profile panel supports playlist-detail video listings", failures);
  assertContains(userProfilePanelSource, "relatedSourceBadge relatedSourceBadgeTop100", "User profile panel renders Top100 source badges", failures);
  assertContains(userProfilePanelSource, "relatedSourceBadge relatedSourceBadgeNew", "User profile panel renders New source badges", failures);
  assertContains(userProfilePanelSource, "className=\"categoryVideoFavouriteButton\"", "User profile panel renders circular favourites controls on listing cards", failures);
  assertContains(userProfilePanelSource, "<SearchResultFavouriteButton", "User profile panel renders add-to-favourites controls", failures);

  // --- Schema: favouriteMutationSchema ---
  assertContains(apiSchemasSource, "export const favouriteMutationSchema", "api-schemas exports favouriteMutationSchema", failures);
  assertContains(apiSchemasSource, "action: z.enum([\"add\", \"remove\"])", "favouriteMutationSchema constrains action to add or remove", failures);
  assertContains(apiSchemasSource, "videoId: z.string().min(1)", "favouriteMutationSchema requires non-empty videoId", failures);

  // --- CSS: favourites layout classes ---
  assertContains(globalCssSource, ".favouritesBlindBar", "globals.css defines .favouritesBlindBar header style", failures);
  assertContains(globalCssSource, ".favouritesCatalogGrid", "globals.css defines .favouritesCatalogGrid layout", failures);
  assertContains(globalCssSource, ".favouritesDeleteButton", "globals.css defines .favouritesDeleteButton style", failures);
  assertContains(globalCssSource, ".favouritesEmptyState", "globals.css defines .favouritesEmptyState style", failures);
  assertContains(globalCssSource, ".artistInlineLink", "globals.css defines inline artist wiki link styling", failures);

  if (failures.length > 0) {
    console.error("Favourites invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Favourites invariant check passed.");
}

main();
