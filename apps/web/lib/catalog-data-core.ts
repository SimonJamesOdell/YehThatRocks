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
import { clearGenreCaches, invalidateRuntimeCategoryCaches } from "@/lib/catalog-data-genres";
import { clearIngestionCaches } from "@/lib/catalog-data-video-ingestion";
import { clearVideosCaches } from "@/lib/catalog-data-videos";
import { clearFavouritesCaches } from "@/lib/catalog-data-favourites";
import { clearHiddenVideoIdsCaches } from "@/lib/catalog-data-hidden";
import { clearHistoryCaches } from "@/lib/catalog-data-history";
import { scheduleCategoriesNewSnapshotBuild } from "@/lib/categories-new-snapshots";
import { clearSitemapDataCaches } from "@/lib/sitemap-data";

export function clearCatalogVideoCaches() {
  clearVideosCaches();
  clearArtistCaches();
  clearGenreCaches();
  clearSitemapDataCaches();
  void invalidateRuntimeCategoryCaches();
  scheduleCategoriesNewSnapshotBuild();
  clearIngestionCaches();
  clearFavouritesCaches();
  clearHiddenVideoIdsCaches();
  clearHistoryCaches();
}

// Wire up the full invalidator so pruneVideoAndAssociationsByVideoId can clear
// all domain caches without creating a circular dependency.
registerFullCacheInvalidator(clearCatalogVideoCaches);
