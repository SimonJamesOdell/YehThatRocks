import { clearCatalogVideoCaches } from "@/lib/catalog-data";
import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";

const APPROVAL_REBUILD_DEBOUNCE_MS = Math.max(
  5_000,
  Math.min(180_000, Number(process.env.CATALOG_APPROVAL_REBUILD_DEBOUNCE_MS || "180_000")),
);

let pendingCatalogVisibilityInvalidationTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleCatalogVisibilityInvalidation(reason = "approval-mutation") {
  void reason;

  if (pendingCatalogVisibilityInvalidationTimer !== null) {
    clearTimeout(pendingCatalogVisibilityInvalidationTimer);
  }

  pendingCatalogVisibilityInvalidationTimer = setTimeout(() => {
    pendingCatalogVisibilityInvalidationTimer = null;
    clearCatalogVideoCaches();
    clearCurrentVideoRouteCaches();
  }, APPROVAL_REBUILD_DEBOUNCE_MS);
}
