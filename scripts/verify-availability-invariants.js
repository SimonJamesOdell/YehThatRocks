#!/usr/bin/env node

/**
 * Availability-system invariants.
 *
 * Guards the catalog availability pipeline so a future edit cannot silently:
 *   1. drop an association table from pruneVideoAndAssociationsByVideoId,
 *   2. remove the site_videos unique constraint on video_id,
 *   3. diverge the status enum (available/unavailable/check-failed), or
 *   4. stop using the YouTube Data API (videos.list) as the primary verifier.
 */

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertInvariant,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  schema: path.join(ROOT, "prisma/schema.prisma"),
  ingestion: path.join(ROOT, "apps/web/lib/catalog-data-video-ingestion.ts"),
  constants: path.join(ROOT, "apps/web/lib/video-ingestion-constants.ts"),
  unavailableRoute: path.join(ROOT, "apps/web/app/api/videos/unavailable/route.ts"),
};

// String-keyed association tables that replaceVideoIdInDatabase repoints. The
// prune function must touch this same set (plus forum refs) so no orphan rows
// survive a video removal.
const STRING_KEYED_ASSOCIATIONS = [
  "related",
  "genre_cards",
  "artist_stats",
  "favourites",
  "watch_history",
  "hidden_videos",
  "messages",
  "analytics_events",
  "magazine_articles",
];

function sliceFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "";
  const end = source.indexOf(endMarker, start);
  return end > start ? source.slice(start, end) : source.slice(start);
}

function main() {
  const failures = [];

  const schemaSource = readFileStrict(files.schema, ROOT);
  const ingestionSource = readFileStrict(files.ingestion, ROOT);
  const constantsSource = readFileStrict(files.constants, ROOT);
  const unavailableRouteSource = readFileStrict(files.unavailableRoute, ROOT);

  // 1. pruneVideoAndAssociationsByVideoId must touch every association table
  //    that replaceVideoIdInDatabase touches.
  const pruneSource = sliceFunction(
    ingestionSource,
    "export async function pruneVideoAndAssociationsByVideoId",
    "export async function getVideoPlaybackDecision",
  );
  const replaceSource = sliceFunction(
    ingestionSource,
    "export async function replaceVideoIdInDatabase",
    "export async function findAndReplaceUnavailableVideo",
  );

  for (const table of STRING_KEYED_ASSOCIATIONS) {
    // genre_cards is cleared via the shared genre helper (not a raw table name).
    if (table === "genre_cards") {
      assertContains(pruneSource, "clearGenreCardThumbnailForVideo", "prune clears genre_cards thumbnail reference", failures);
      assertContains(replaceSource, "genre_cards", "replace repoints genre_cards thumbnail reference", failures);
      continue;
    }

    assertContains(pruneSource, table, `pruneVideoAndAssociationsByVideoId touches ${table}`, failures);
    assertContains(replaceSource, table, `replaceVideoIdInDatabase touches ${table}`, failures);
  }

  // Forum references exist in prune (A3 added them); ensure they are not dropped.
  assertContains(pruneSource, "forum_threads", "prune clears forum_threads video references", failures);

  // 2. SiteVideo must have a UNIQUE constraint on video_id.
  assertContains(
    schemaSource,
    '@@unique([videoId], map: "site_videos_video_id_key")',
    "SiteVideo has a unique constraint on video_id",
    failures,
  );

  // 3. Status enum values are used consistently across the availability system.
  assertContains(
    constantsSource,
    'export type VideoAvailabilityStatus = "available" | "unavailable" | "check-failed";',
    "Availability status enum is canonical in video-ingestion-constants",
    failures,
  );
  assertContains(
    unavailableRouteSource,
    'status: "available" | "unavailable" | "check-failed";',
    "Unavailable route uses the same three status values",
    failures,
  );
  assertContains(ingestionSource, "'available'", "Playback decision uses the 'available' status", failures);
  assertContains(ingestionSource, "'unavailable'", "Playback decision uses the 'unavailable' status", failures);
  assertContains(ingestionSource, "'check-failed'", "Playback decision uses the 'check-failed' status", failures);

  // 4. verifyYouTubeAvailability uses the YouTube Data API (videos.list) as
  //    the primary check, falling back to oEmbed only when the API is unusable.
  assertContains(
    unavailableRouteSource,
    "checkEmbedPlayability",
    "Unavailable route imports the Data API availability check",
    failures,
  );
  assertContains(
    unavailableRouteSource,
    "await checkEmbedPlayability(videoId)",
    "Unavailable route calls the Data API availability check",
    failures,
  );
  assertContains(
    ingestionSource,
    "https://www.googleapis.com/youtube/v3/videos",
    "Availability check targets the Data API videos.list endpoint",
    failures,
  );
  assertInvariant(
    unavailableRouteSource.indexOf("await checkEmbedPlayability(videoId)") !== -1 &&
      unavailableRouteSource.indexOf("await checkEmbedPlayability(videoId)") <
        unavailableRouteSource.indexOf("youtube.com/oembed"),
    "Data API check runs before the oEmbed scrape fallback",
    "",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Availability-system invariant check failed.",
    successMessage: "Availability-system invariant check passed.",
  });
}

main();
