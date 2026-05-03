#!/usr/bin/env node

const path = require("node:path");
const { readFileStrict, assertContains, assertNotContains, finishInvariantCheck } = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  thumbnailComponent: path.join(ROOT, "apps/web/components/youtube-thumbnail-image.tsx"),
  categoriesFilterGrid: path.join(ROOT, "apps/web/components/categories-filter-grid.tsx"),
  categoryVideoCard: path.join(ROOT, "apps/web/components/artist-video-link.tsx"),
  categoryVideosInfinite: path.join(ROOT, "apps/web/components/category-videos-infinite.tsx"),
  unavailableRoute: path.join(ROOT, "apps/web/app/api/videos/unavailable/route.ts"),
  categorySlugRoute: path.join(ROOT, "apps/web/app/api/categories/[slug]/route.ts"),
  categoryErrorBoundary: path.join(ROOT, "apps/web/app/(shell)/categories/[slug]/error.tsx"),
};

function main() {
  const failures = [];

  const thumbnailComponentSource = readFileStrict(files.thumbnailComponent, ROOT);
  const categoriesFilterGridSource = readFileStrict(files.categoriesFilterGrid, ROOT);
  const categoryVideoCardSource = readFileStrict(files.categoryVideoCard, ROOT);
  const categoryVideosInfiniteSource = readFileStrict(files.categoryVideosInfinite, ROOT);
  const unavailableRouteSource = readFileStrict(files.unavailableRoute, ROOT);
  const categorySlugRouteSource = readFileStrict(files.categorySlugRoute, ROOT);
  const categoryErrorBoundarySource = readFileStrict(files.categoryErrorBoundary, ROOT);

  // Thumbnail pre-flight contract invariants.
  assertContains(thumbnailComponentSource, 'return buildThumbUrl(videoId, "hqdefault");', "Thumbnail probe uses hqdefault rather than low-res variants", failures);
  assertContains(thumbnailComponentSource, "isLikelyUnavailableThumbnailDimensions(", "Thumbnail probe delegates tiny-placeholder classification to shared health utility", failures);
  assertContains(thumbnailComponentSource, 'thumbnailHealthCache.set(videoId, "broken");', "Thumbnail component writes broken state to cache", failures);
  assertContains(thumbnailComponentSource, "const brokenMarkerRef = useRef<HTMLSpanElement | null>(null);", "Thumbnail component keeps a fallback marker for broken-state card hiding", failures);
  assertContains(thumbnailComponentSource, "const anchorElement = elementRef.current ?? brokenMarkerRef.current;", "Thumbnail component can hide parent card even when img is no longer mounted", failures);
  assertContains(thumbnailComponentSource, "closest.style.display = \"none\";", "Thumbnail component hides broken-card container", failures);
  assertContains(thumbnailComponentSource, 'closest.setAttribute("data-thumbnail-broken", "1");', "Thumbnail component marks broken-card container for diagnostics", failures);
  assertContains(thumbnailComponentSource, "reportUnavailable(videoId, reportReason);", "Thumbnail component reports broken thumbnails to backend verifier", failures);

  // Categories routes and cards must use shared thumbnail pre-flight component.
  assertContains(categoriesFilterGridSource, 'import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";', "Categories filter grid imports shared thumbnail pre-flight component", failures);
  assertContains(categoriesFilterGridSource, "<YouTubeThumbnailImage", "Categories filter grid renders shared thumbnail pre-flight component", failures);
  assertNotContains(categoriesFilterGridSource, "i.ytimg.com/vi/", "Categories filter grid no longer renders direct thumbnail URLs", failures);

  assertContains(categoryVideoCardSource, 'import { YouTubeThumbnailImage } from "@/components/youtube-thumbnail-image";', "Category video cards import shared thumbnail pre-flight component", failures);
  assertContains(categoryVideoCardSource, "<YouTubeThumbnailImage", "Category video cards render shared thumbnail pre-flight component", failures);
  assertNotContains(categoryVideoCardSource, "i.ytimg.com/vi/", "Category video cards no longer render direct thumbnail URLs", failures);

  // Backend unavailable-report handling contract.
  assertContains(unavailableRouteSource, "const verification = await verifyYouTubeAvailability(videoId);", "Unavailable-report API re-verifies reported IDs before pruning", failures);
  assertContains(unavailableRouteSource, "if (verification.status !== \"unavailable\")", "Unavailable-report API avoids pruning when status is not confirmed unavailable", failures);
  assertContains(unavailableRouteSource, "const pruneResult = await pruneVideoAndAssociationsByVideoId(", "Unavailable-report API prunes unavailable videos and related associations", failures);

  // Categories hard-fail contract.
  assertContains(categorySlugRouteSource, "catch (error)", "Category slug API wraps request path in a hard-fail catch boundary", failures);
  assertContains(categorySlugRouteSource, "{ status: 503 }", "Category slug API returns 503 when canonical data cannot be served", failures);
  assertContains(categorySlugRouteSource, "The system cannot serve this request right now. Please try again later.", "Category slug API returns explicit hard-fail retry message", failures);
  assertContains(categoryErrorBoundarySource, "The system cannot serve this request right now. Please try again later.", "Category route error boundary shows hard-fail retry notification", failures);
  assertContains(categoryVideosInfiniteSource, "failureMessage: \"The system cannot serve this request right now. Please try again later.\"", "Category infinite loader uses explicit hard-fail notification for API failures", failures);
  assertContains(categoryVideosInfiniteSource, "setLoadError(\"The system cannot serve this request right now. Please try again later.\");", "Category infinite loader preserves explicit retry-later message for caught request failures", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Thumbnail pre-flight invariant check failed.",
    successMessage: "Thumbnail pre-flight invariant check passed.",
  });
}

main();
