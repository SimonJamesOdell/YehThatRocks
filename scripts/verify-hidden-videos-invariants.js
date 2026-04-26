#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  prismaSchema: path.join(ROOT, "prisma/schema.prisma"),
  migration: path.join(ROOT, "prisma/migrations/20260412030719_auto/migration.sql"),
  apiRoute: path.join(ROOT, "apps/web/app/api/hidden-videos/route.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data.ts"),
  apiSchemas: path.join(ROOT, "apps/web/lib/api-schemas.ts"),
  shellLayout: path.join(ROOT, "apps/web/app/(shell)/layout.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic.tsx"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience.tsx"),
  newPage: path.join(ROOT, "apps/web/app/(shell)/new/page.tsx"),
  newLoader: path.join(ROOT, "apps/web/components/new-videos-loader.tsx"),
  top100Page: path.join(ROOT, "apps/web/app/(shell)/top100/page.tsx"),
  top100Loader: path.join(ROOT, "apps/web/components/top100-videos-loader.tsx"),
  categoryPage: path.join(ROOT, "apps/web/app/(shell)/categories/[slug]/page.tsx"),
  categoryLoader: path.join(ROOT, "apps/web/components/category-videos-infinite.tsx"),
  artistPage: path.join(ROOT, "apps/web/app/(shell)/artist/[slug]/page.tsx"),
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

function main() {
  const failures = [];

  const prismaSchemaSource = read(files.prismaSchema);
  const migrationSource = read(files.migration);
  const apiRouteSource = read(files.apiRoute);
  const catalogDataSource = read(files.catalogData);
  const apiSchemasSource = read(files.apiSchemas);
  const shellLayoutSource = read(files.shellLayout);
  const shellDynamicSource = read(files.shellDynamic);
  const playerExperienceSource = read(files.playerExperience);
  const newPageSource = read(files.newPage);
  const newLoaderSource = read(files.newLoader);
  const top100PageSource = read(files.top100Page);
  const top100LoaderSource = read(files.top100Loader);
  const categoryPageSource = read(files.categoryPage);
  const categoryLoaderSource = read(files.categoryLoader);
  const artistPageSource = read(files.artistPage);

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

  // UI usage invariants.
  assertContains(shellLayoutSource, "initialHiddenVideoIds={Array.from(hiddenVideoIds)}", "Shell layout forwards hidden ids to shell dynamic", failures);
  assertContains(shellDynamicSource, "initialHiddenVideoIds", "Shell dynamic accepts hidden ids", failures);
  assertContains(shellDynamicSource, "filterHiddenRelatedVideos", "Shell dynamic filters Watch Next by hidden ids", failures);
  assertContains(shellDynamicSource, "relatedCardHideButton", "Shell dynamic renders hide button on Watch Next cards", failures);
  assertContains(shellDynamicSource, 'fetchWithAuthRetry("/api/hidden-videos"', "Shell dynamic persists hidden Watch Next cards to hidden-videos API", failures);

  assertContains(newPageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "New page passes hidden ids to loader", failures);
  assertContains(newLoaderSource, "filterHiddenVideos", "New loader filters hidden videos", failures);

  assertContains(top100PageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "Top100 page passes hidden ids to loader", failures);
  assertContains(top100LoaderSource, "filterHiddenVideos", "Top100 loader filters hidden videos", failures);

  assertContains(categoryPageSource, "hiddenVideoIds={Array.from(hiddenVideoIds)}", "Category page passes hidden ids to loader", failures);
  assertContains(categoryLoaderSource, "filterHiddenVideos", "Category loader filters hidden videos", failures);

  assertContains(artistPageSource, "getHiddenVideoIdsForUser", "Artist page loads hidden video ids", failures);
  assertContains(artistPageSource, "!hiddenVideoIds.has(video.id)", "Artist page excludes hidden videos", failures);

  // Player hide-video safety invariant: the player MUST pause active playback before
  // performing the hide flow. Without this, the hidden video keeps playing audio in the
  // dock after the skip transition completes.
  assertContains(playerExperienceSource, "function pauseActivePlayback(", "Player defines pauseActivePlayback helper to stop audio on hide", failures);
  assertContains(playerExperienceSource, "pauseActivePlayback();", "Player calls pauseActivePlayback when hiding current video", failures);
  assertContains(playerExperienceSource, "const activePlaylistQuery = activePlaylistId ? `?activePlaylistId=${encodeURIComponent(activePlaylistId)}` : \"\";", "Player sends active playlist context when blocking current video", failures);
  assertContains(playerExperienceSource, "dispatchAppEvent(EVENT_NAMES.PLAYLISTS_UPDATED, null)", "Player refreshes playlist state after blocking current video", failures);
  assertContains(playerExperienceSource, "if (payload?.activePlaylistDeleted)", "Player handles active playlist deletion response after block", failures);
  assertContains(playerExperienceSource, "params.delete(\"pl\");", "Player clears active playlist id when blocked track deletes playlist", failures);
  assertContains(playerExperienceSource, "params.delete(\"pli\");", "Player clears active playlist index when blocked track deletes playlist", failures);

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
