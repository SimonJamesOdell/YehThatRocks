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
} = require("./invariants/helpers");
const { applyQueueResolutionRulePack } = require("./invariants/rule-packs/queue-resolution-pack");

const ROOT = process.cwd();

const files = {
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  shellDynamicRendering: path.join(ROOT, "apps/web/components/shell-dynamic-rendering.tsx"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  metadataUtils: path.join(ROOT, "apps/web/lib/catalog-metadata-utils.ts"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  nextTrackDecisionHook: path.join(ROOT, "apps/web/components/use-next-track-decision.ts"),
  temporaryQueueControllerHook: path.join(ROOT, "apps/web/components/use-temporary-queue-controller.ts"),
  playerNextTrackDomain: path.join(ROOT, "apps/web/domains/player/resolve-next-track-target.ts"),
  queueDomain: path.join(ROOT, "apps/web/domains/queue/temporary-queue.ts"),
  playlistDomain: path.join(ROOT, "apps/web/domains/playlist/playlist-step-target.ts"),
  playerEvents: path.join(ROOT, "apps/web/lib/player-events.ts"),
};

function main() {
  const failures = [];

  const shellDynamicSource = readFileStrict(files.shellDynamic, ROOT);
  const shellDynamicRenderingSource = readFileStrict(files.shellDynamicRendering, ROOT);
  const shellRenderingSource = `${shellDynamicSource}\n${shellDynamicRenderingSource}`;
  const currentVideoRouteSource = readFileStrict(files.currentVideoRoute, ROOT);
  const catalogDataSource = readFileStrict(files.catalogData, ROOT);
  const metadataUtilsSource = readFileStrict(files.metadataUtils, ROOT);
  const classificationSource = `${catalogDataSource}\n${metadataUtilsSource}`;
  const playerExperienceSource = readFileStrict(files.playerExperience, ROOT);
  const nextTrackDecisionHookSource = readFileStrict(files.nextTrackDecisionHook, ROOT);
  const temporaryQueueControllerHookSource = readFileStrict(files.temporaryQueueControllerHook, ROOT);
  const playerNextTrackDomainSource = readFileStrict(files.playerNextTrackDomain, ROOT);
  const queueDomainSource = readFileStrict(files.queueDomain, ROOT);
  const playlistDomainSource = readFileStrict(files.playlistDomain, ROOT);
  const playerEventsSource = readFileStrict(files.playerEvents, ROOT);

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

  // Current-video API invariants.
  assertContains(currentVideoRouteSource, "const targetRelatedCount = 8;", "Current-video API targets 8 Watch Next items", failures);
  assertContains(currentVideoRouteSource, "earlyTopVideosForPadding ?? await getCachedTopVideosForCurrentVideo(30)", "Current-video API fetches bounded filler pool (parallel-prefetched or direct)", failures);
  assertContains(currentVideoRouteSource, "const filler = shuffleVideos(fillerPool).slice(0, targetRelatedCount - relatedVideos.length);", "Current-video API randomizes sparse filler selection", failures);

  // Catalog data support invariants for fallback sourcing.
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

  if (failures.length > 0) {
    console.error("Core experience invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Core experience invariant check passed.");
}

main();
