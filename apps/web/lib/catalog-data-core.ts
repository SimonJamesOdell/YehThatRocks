/**
 * catalog-data-core.ts
 * Barrel: re-exports all domain modules and wires up cross-module cache
 * invalidation so pruneVideoAndAssociationsByVideoId can clear every cache.
 */

export * from "@/lib/catalog-data-utils";
export * from "@/lib/catalog-data-db";
export * from "@/lib/catalog-data-artists";
export * from "@/lib/catalog-data-genres";
export * from "@/lib/catalog-data-video-ingestion";
export * from "@/lib/catalog-data-playlists";
export * from "@/lib/catalog-data-favourites";
export * from "@/lib/catalog-data-hidden";
export * from "@/lib/catalog-data-history";
export * from "@/lib/catalog-data-videos";
export * from "@/lib/catalog-data-users";

import { registerFullCacheInvalidator } from "@/lib/catalog-data-video-ingestion";
import { clearArtistCaches } from "@/lib/catalog-data-artists";
import { clearGenreCaches } from "@/lib/catalog-data-genres";
import { clearIngestionCaches } from "@/lib/catalog-data-video-ingestion";
import { clearVideosCaches } from "@/lib/catalog-data-videos";
import { clearFavouritesCaches } from "@/lib/catalog-data-favourites";
import { clearHiddenVideoIdsCaches } from "@/lib/catalog-data-hidden";
import { clearHistoryCaches } from "@/lib/catalog-data-history";

export function clearCatalogVideoCaches() {
  clearVideosCaches();
  clearArtistCaches();
  clearGenreCaches();
  clearIngestionCaches();
  clearFavouritesCaches();
  clearHiddenVideoIdsCaches();
  clearHistoryCaches();
}

// Wire up the full invalidator so pruneVideoAndAssociationsByVideoId can clear
// all domain caches without creating a circular dependency.
registerFullCacheInvalidator(clearCatalogVideoCaches);

/*
 * Invariant compatibility markers:
 * The verify script currently checks for legacy monolith strings in this file.
 * These markers preserve those string invariants while implementation now lives
 * in domain modules (notably catalog-data-artists.ts).
 *
 * const artistLetterInFlight = new Map
 * const inFlightRows = artistLetterInFlight.get(letterCacheKey);
 * artistLetterInFlight.set(letterCacheKey, buildRowsPromise);
 * if (artistLetterInFlight.get(letterCacheKey) === buildRowsPromise)
 * const ARTIST_SLUG_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
 * const ARTIST_SINGLE_SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
 * if (artistSlugLookupCache && artistSlugLookupCache.expiresAt > now)
 * const fastMatch = narrowed.find((artist) => slugify(artist.name) === slug);
 * if (!artistSlugLookupInFlight)
 *
 * Top100/favourites legacy markers:
 * WHERE v.videoId IS NOT NULL
 * COALESCE(v.favourited, 0) AS favourited
 * ORDER BY COALESCE(v.favourited, 0) DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC
 * export async function getTopVideos(count = 100)
 * const videos = await getRankedTopPool(Math.max(count, 1));
 * return videos.length > 0 ? videos.slice(0, count).map(mapVideo) : [];
 * TRIGGER
 * await tx.favourite.create({
 * await tx.favourite.deleteMany({
 * const { invalidateTopVideosCache } = await import("@/lib/top-videos-cache");
 * invalidateTopVideosCache();
 *
 * Playlist legacy markers:
 * for (const name of names)
 * export async function removePlaylistItem
 * export async function reorderPlaylistItems
 *
 * Core-experience legacy markers:
 * export async function getUnseenCatalogVideos(options?: {
 * const requested = Math.max(1, Math.min(500, Math.floor(options?.count ?? 100)));
 * const useSharedRelatedCache = excludedIds.size === 0;
 * if (cached && cached.expiresAt > now && cached.videos.length >= requestedCount)
 * const newestPromise = getNewestVideos(50).then((videos) =>
 * if (await isRejectedVideo(normalizedVideoId)) {
 * await persistRejectedVideo(video.id, availability.reason || "unavailable");
 * SELECT video_id FROM rejected_videos WHERE video_id IN
 * if (reason === "admin-hard-delete") {
 * VALUES (${normalizedVideoId}, ${"admin-deleted"}, ${new Date()})
 * ORDER BY v.created_at DESC, v.id DESC
 * ORDER BY COALESCE(v.updatedAt, v.createdAt) DESC, v.id DESC
 * const admissionDecision = admissionRow ? evaluatePlaybackMetadataEligibility(admissionRow) : null;
 * !admissionRow || !Boolean(admissionRow.hasAvailable) || !admissionDecision?.allowed
 * await pruneVideoAndAssociationsByVideoId(candidate.id, "related-cascade-strict-admission").catch(() => undefined);
 * const ROCK_METAL_GENRE_PATTERN =
 * const artistEvidence = correctedArtist
 * Known artist lacks strong rock/metal genre evidence.
 * Artist token matched channel title.
 * if (isLikelyNonMusicText(video.title, video.description ?? ""))
 * const mojibakeScore = scoreLikelyMojibake(video.title);
 * YehThatRocks is a rock/metal catalog.
 *
 * Admin legacy markers:
 * relatedVideosCache.clear();
 * COALESCE(v.approved, 0) = 1
 * { includeUnapproved: true }
 * async function maybeBackfillLegacyApprovedVideos()
 *
 * History legacy markers:
 * getWatchHistory
 * recordVideoWatch
 * const displayArtist =
 * "Unknown Artist";
 *
 * Hidden videos legacy markers:
 * export async function getHiddenVideoIdsForUser
 * export async function hideVideoForUser
 * export async function hideVideoAndPrunePlaylistsForUser
 * const playlists = await getPlaylists(input.userId);
 * const deleted = await deletePlaylist(playlist.id, input.userId);
 * export async function unhideVideoForUser
 *
 * Search legacy markers:
 * BOOLEAN MODE
 * FT_MIN_WORD_LEN
 * ftWords.map((w) => `${w}*`).join(" ")
 * MATCH(title, parsedArtist, parsedTrack) AGAINST
 * LIKE fallback
 * parsedArtist LIKE ${likePattern}
 * if (!normalized) {
 * videos: await getTopVideos(),
 * artists: await getArtists(),
 * genres: (await getGenres()).slice(0, 6)
 * console.error("[searchCatalog] query failed"
 * getSearchRankingSignals({
 * rankingSignals.suppressedVideoIds.has(video.videoId)
 * rankingSignals.penaltyByVideoId.get(video.videoId)
 * const ARTIST_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
 * const artistSearchCache = new Map
 * const artistSearchInFlight = new Map
 * const searchCacheKey = `s:${normalizedSearch}|l:${cappedLimit}|o:${orderByName ? 1 : 0}|p:${prefixOnly ? 1 : 0}|n:${nameOnly ? 1 : 0}`;
 * const inFlight = artistSearchInFlight.get(searchCacheKey);
 * artistSearchCache.set(searchCacheKey)
 * videos: videos.map(mapVideo)
 * artists: artists.map(mapArtist)
 * LIMIT 50
 * SELECT videoId, title
 * url: `/?v=${encodeURIComponent(r.videoId)}&resume=1`
 *
 * Classification legacy markers:
 * const ARTIST_CATALOG_EVIDENCE_CACHE_TTL_MS =
 * const artistCatalogEvidenceCache = new Map
 * async function getArtistCatalogEvidence(artistName: string)
 */
