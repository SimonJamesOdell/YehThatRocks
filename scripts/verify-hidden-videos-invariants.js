#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  prismaSchema: path.join(ROOT, "prisma/schema.prisma"),
  migration: path.join(ROOT, "prisma/migrations/20260412030719_auto/migration.sql"),
  apiRoute: path.join(ROOT, "apps/web/app/api/hidden-videos/route.ts"),
  hiddenVideoClient: path.join(ROOT, "apps/web/lib/hidden-video-client-service.ts"),
  hiddenDataModule: path.join(ROOT, "apps/web/lib/catalog-data-hidden.ts"),
  favouritesDataModule: path.join(ROOT, "apps/web/lib/catalog-data-favourites.ts"),
  historyDataModule: path.join(ROOT, "apps/web/lib/catalog-data-history.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  shellLayout: path.join(ROOT, "apps/web/app/(shell)/layout.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  newPage: path.join(ROOT, "apps/web/app/(shell)/new/page.tsx"),
  newLoader: path.join(ROOT, "apps/web/components/new-videos-loader.tsx"),
  newDataLoaderHook: path.join(ROOT, "apps/web/components/use-new-videos-data-loader.ts"),
  top100Page: path.join(ROOT, "apps/web/app/(shell)/top100/page.tsx"),
  top100Loader: path.join(ROOT, "apps/web/components/top100-videos-loader.tsx"),
  categoryPage: path.join(ROOT, "apps/web/app/(shell)/categories/[slug]/page.tsx"),
  categoryLoader: path.join(ROOT, "apps/web/components/category-videos-infinite.tsx"),
  artistPage: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/page.tsx"),
  videoListUtils: path.join(ROOT, "apps/web/lib/video-list-utils.ts"),
};

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(ROOT, filePath)}`);
  }

  return fs.readFileSync(filePath, "utf8");
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

  const prismaSchemaSource = read(files.prismaSchema);
  const migrationSource = read(files.migration);
  const apiRouteSource = read(files.apiRoute);
  const hiddenVideoClientSource = read(files.hiddenVideoClient);
  const hiddenDataModuleSource = read(files.hiddenDataModule);
  const favouritesDataModuleSource = read(files.favouritesDataModule);
  const historyDataModuleSource = read(files.historyDataModule);
  const catalogDataSource = read(files.catalogData);
  const apiSchemasSource = read(files.apiSchemas);
  const shellLayoutSource = read(files.shellLayout);
  const shellDynamicSource = [
    read(files.shellDynamic),
    read(path.join(ROOT, 'apps/web/components/use-chat-state.ts')),
    read(path.join(ROOT, 'apps/web/components/use-playlist-rail.ts')),
    read(path.join(ROOT, 'apps/web/components/use-performance-metrics.ts')),
    read(path.join(ROOT, 'apps/web/components/use-desktop-intro.ts')),
    read(path.join(ROOT, 'apps/web/components/use-search-autocomplete.ts')),
  ].join('\n');
  const playerExperienceSource = read(files.playerExperience);
  const newPageSource = read(files.newPage);
  const newLoaderSource = read(files.newLoader);
  const newDataLoaderHookSource = read(files.newDataLoaderHook);
  const top100PageSource = read(files.top100Page);
  const top100LoaderSource = read(files.top100Loader);
  const categoryPageSource = read(files.categoryPage);
  const categoryLoaderSource = read(files.categoryLoader);
  const artistPageSource = read(files.artistPage);
  const videoListUtilsSource = read(files.videoListUtils);

  // DB + Prisma invariants.
  assertContains(prismaSchemaSource, "model HiddenVideo", "Prisma schema defines HiddenVideo model", failures);
  assertContains(prismaSchemaSource, '@@map("hidden_videos")', "HiddenVideo model maps to hidden_videos table", failures);
  assertContains(prismaSchemaSource, '@@unique([userId, videoId])', "HiddenVideo enforces per-user uniqueness", failures);
  assertContains(migrationSource, "CREATE TABLE IF NOT EXISTS `hidden_videos`", "Hidden videos migration creates table idempotently", failures);
  assertContains(migrationSource, "`hidden_videos_user_id_video_id_key`", "Hidden videos migration enforces unique user/video rows", failures);

  // Data helpers + API invariants.
  assertContains(catalogDataSource, "export async function getHiddenVideoIdsForUser", "Catalog data exposes hidden video lookup", failures);
  assertContains(catalogDataSource, "export async function hideVideoForUser", "Catalog data exposes hide operation", failures);
  assertContains(catalogDataSource, "export async function hideVideoAndPrunePlaylistsForUser", "Catalog data exposes hide+playlist-prune operation", failures);
  assertContains(catalogDataSource, "const playlists = await getPlaylists(input.userId);", "Hide+prune operation enumerates user playlists", failures);
  assertContains(catalogDataSource, "const deleted = await deletePlaylist(playlist.id, input.userId);", "Hide+prune operation deletes empty playlists", failures);
  assertContains(catalogDataSource, "export async function unhideVideoForUser", "Catalog data exposes unhide operation", failures);
  assertContains(apiSchemasSource, "export const hiddenVideoMutationSchema", "API schemas define hidden video mutation payload", failures);
  assertContains(apiRouteSource, "export async function GET", "Hidden videos route supports GET", failures);
  assertContains(apiRouteSource, "export async function POST", "Hidden videos route supports POST", failures);
  assertContains(apiRouteSource, "export async function DELETE", "Hidden videos route supports DELETE", failures);
  assertContains(apiRouteSource, "const activePlaylistId = request.nextUrl.searchParams.get(\"activePlaylistId\");", "Hidden videos POST accepts active playlist context", failures);
  assertContains(apiRouteSource, "hideVideoAndPrunePlaylistsForUser", "Hidden videos POST uses hide+prune helper", failures);
  assertContains(apiRouteSource, "activePlaylistDeleted: result.activePlaylistDeleted", "Hidden videos POST returns activePlaylistDeleted result", failures);
  assertContains(hiddenVideoClientSource, "export async function mutateHiddenVideo", "Client exposes shared hidden video mutation helper", failures);
  assertContains(hiddenVideoClientSource, "fetchWithAuthRetry(resolveRequestUrl(action, activePlaylistId)", "Shared hidden video client uses auth-retry fetch", failures);
  assertContains(hiddenVideoClientSource, "rollbackOnError = false", "Shared hidden video client supports optional rollback", failures);
  assertContains(hiddenVideoClientSource, "onOptimisticUpdate?.();", "Shared hidden video client supports optimistic hooks", failures);
  assertContains(hiddenVideoClientSource, "messages.failure", "Shared hidden video client provides standard failure messaging", failures);
  assertContains(hiddenDataModuleSource, "const hiddenVideoIdsCache = new BoundedMap", "Hidden videos module bounds user hidden-id cache", failures);
  assertContains(hiddenDataModuleSource, "const hiddenVideoIdsInFlight = new BoundedMap", "Hidden videos module bounds in-flight hidden-id requests", failures);
  assertContains(favouritesDataModuleSource, "const favouriteVideosInFlight = new BoundedMap", "Favourites module bounds in-flight favourite requests", failures);
  assertContains(historyDataModuleSource, "const seenVideoIdsInFlight = new BoundedMap", "History module bounds in-flight seen-id requests", failures);

  // UI usage invariants.
  assertContains(shellLayoutSource, "initialHiddenVideoIds={Array.from(hiddenVideoIds)}", "Shell layout forwards hidden ids to shell dynamic", failures);
  assertContains(shellDynamicSource, "initialHiddenVideoIds", "Shell dynamic accepts hidden ids", failures);
  assertContains(shellDynamicSource, "filterHiddenVideos", "Shell dynamic filters Watch Next by hidden ids", failures);
  assertContains(shellDynamicSource, "relatedCardHideButton", "Shell dynamic renders hide button on Watch Next cards", failures);
  assertContains(shellDynamicSource, "mutateHiddenVideo({", "Shell dynamic uses shared hidden-video mutation helper", failures);

  assertContains(newPageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "New page passes hidden ids to loader", failures);
  assertContains(newPageSource, "getShellRequestVideoState", "New page resolves hidden ids through shared shell request state helper", failures);
  assertContains(newLoaderSource, 'import { useNewVideosDataLoader } from "@/components/use-new-videos-data-loader";', "New loader delegates data filtering/loading to dedicated hook", failures);
  assertContains(newDataLoaderHookSource, "filterHiddenVideos", "New data loader hook filters hidden videos", failures);

  assertContains(top100PageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "Top100 page passes hidden ids to loader", failures);
  assertContains(top100PageSource, "getShellRequestVideoState", "Top100 page resolves hidden ids through shared shell request state helper", failures);
  assertContains(top100LoaderSource, "filterHiddenVideos", "Top100 loader filters hidden videos", failures);

  assertContains(categoryPageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "Category page passes hidden ids to loader", failures);
  assertContains(categoryPageSource, "getShellRequestVideoState", "Category page resolves hidden ids through shared shell request state helper", failures);
  assertContains(categoryLoaderSource, "filterHiddenVideos", "Category loader filters hidden videos", failures);

  assertContains(artistPageSource, "getShellRequestVideoState", "Artist page loads hidden video ids through shared shell request state helper", failures);
  assertContains(artistPageSource, "!hiddenVideoIds.has(video.id)", "Artist page excludes hidden videos", failures);

  // video-list-utils shared utility invariants.
  assertContains(videoListUtilsSource, "export function dedupeVideos", "video-list-utils exports dedupeVideos", failures);
  assertContains(videoListUtilsSource, "export function filterHiddenVideos", "video-list-utils exports filterHiddenVideos", failures);
  assertContains(videoListUtilsSource, "!video?.id", "dedupeVideos guards against null/undefined video ids", failures);
  assertContains(categoryLoaderSource, 'from "@/lib/video-list-utils"', "Category loader imports from shared video-list-utils", failures);
  assertContains(newDataLoaderHookSource, 'from "@/lib/video-list-utils"', "New data loader hook imports from shared video-list-utils", failures);
  assertContains(top100LoaderSource, 'from "@/lib/video-list-utils"', "Top100 loader imports from shared video-list-utils", failures);
  assertContains(shellDynamicSource, 'from "@/lib/video-list-utils"', "Shell dynamic imports from shared video-list-utils", failures);

  // Player hide-video safety invariant: the player MUST pause active playback before
  // performing the hide flow. Without this, the hidden video keeps playing audio in the
  // dock after the skip transition completes.
  assertContains(playerExperienceSource, "function pauseActivePlayback(", "Player defines pauseActivePlayback helper to stop audio on hide", failures);
  assertContains(playerExperienceSource, "pauseActivePlayback();", "Player calls pauseActivePlayback when hiding current video", failures);
  assertContains(playerExperienceSource, "activePlaylistId,", "Player forwards active playlist context when blocking current video", failures);
  assertContains(playerExperienceSource, "mutateHiddenVideo<{ activePlaylistDeleted?: boolean }>", "Player uses shared hidden-video mutation helper", failures);
  assertContains(playerExperienceSource, "dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null)", "Player refreshes playlist state after blocking current video", failures);
  assertContains(playerExperienceSource, "if (result.payload?.activePlaylistDeleted)", "Player handles active playlist deletion response after block", failures);
  assertContains(playerExperienceSource, "params.delete(\"pl\");", "Player clears active playlist id when blocked track deletes playlist", failures);
  assertContains(playerExperienceSource, "params.delete(\"pli\");", "Player clears active playlist index when blocked track deletes playlist", failures);

  // force-dynamic / dead-config guards.
  assertContains(shellLayoutSource, 'export const dynamic = "force-dynamic"', "Shell layout opts out of static generation via force-dynamic", failures);
  assertNotContains(categoryPageSource, "export const revalidate", "Category detail page must not carry a dead revalidate directive (force-dynamic parent makes it a no-op)", failures);

  if (failures.length > 0) {
    console.error("Hidden videos invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Hidden videos invariant check passed.");
}

main();
