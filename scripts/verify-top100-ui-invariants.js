#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  top100Page: path.join(ROOT, "apps/web/app/(shell)/top100/page.tsx"),
  top100Link: path.join(ROOT, "apps/web/components/top100-video-link.tsx"),
  top100Loader: path.join(ROOT, "apps/web/components/top100-videos-loader.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic.tsx"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data.ts"),
  globalCss: path.join(ROOT, "apps/web/app/globals.css"),
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

  const top100PageSource = read(files.top100Page);
  const top100LinkSource = read(files.top100Link);
  const top100LoaderSource = read(files.top100Loader);
  const shellDynamicSource = read(files.shellDynamic);
  const currentVideoRouteSource = read(files.currentVideoRoute);
  const catalogDataSource = read(files.catalogData);
  const globalCssSource = read(files.globalCss);

  // Top 100 page should delegate heavy list work to client loader for faster shell open.
  assertContains(top100PageSource, 'import { Top100VideosLoader } from "@/components/top100-videos-loader";', "Top 100 page imports client videos loader", failures);
  assertContains(top100PageSource, "<Top100VideosLoader isAuthenticated={isAuthenticated} seenVideoIds={Array.from(seenVideoIds)} />", "Top 100 page renders client videos loader with seen ids", failures);
  assertContains(top100LoaderSource, 'import { Top100VideoLink } from "@/components/top100-video-link";', "Top 100 loader renders warmed link component", failures);
  assertContains(top100LoaderSource, "fetch(\"/api/videos/top?count=100\"", "Top 100 loader fetches videos from top API", failures);
  assertContains(top100LoaderSource, "TOP100_SESSION_CACHE_KEY", "Top 100 loader uses session cache to reduce repeat requests", failures);
  assertNotContains(top100LoaderSource, "sortVideosBySeen(", "Top 100 loader does not reorder rows by seen state", failures);
  assertNotContains(top100LoaderSource, "/api/watch-history", "Top 100 loader does not pad with watch history rows", failures);

  // Warmed handoff invariants in the top100 link component.
  assertContains(top100LinkSource, "const PENDING_VIDEO_SELECTION_KEY = \"ytr:pending-video-selection\";", "Top 100 warmed link uses pending selection cache key", failures);
  assertContains(top100LinkSource, "window.sessionStorage.setItem(", "Top 100 warmed link writes optimistic pending selection", failures);
  assertContains(top100LinkSource, "void fetch(`/api/current-video?v=${encodeURIComponent(track.id)}`", "Top 100 warmed link prefetches current-video payload", failures);
  assertContains(top100LinkSource, "href={`/?v=${track.id}&resume=1`}", "Top 100 warmed link navigates with v+resume query", failures);
  assertContains(top100LinkSource, "onMouseEnter={stagePendingSelection}", "Top 100 warmed link stages pending selection on hover", failures);
  assertContains(top100LinkSource, "onFocus={stagePendingSelection}", "Top 100 warmed link stages pending selection on focus", failures);
  assertContains(top100LinkSource, "onPointerDown={warmSelection}", "Top 100 warmed link warms on pointer-down", failures);
  assertContains(top100LinkSource, "onClick={warmSelection}", "Top 100 warmed link warms on click", failures);
  assertContains(top100LinkSource, "prefetch={false}", "Top 100 warmed link disables Next.js link prefetch fan-out", failures);
  assertContains(top100LinkSource, "TOP100_WARM_LIMIT_PER_WINDOW", "Top 100 warmed link caps warm requests per time window", failures);
  assertContains(top100LinkSource, 'import { ArtistWikiLink } from "@/components/artist-wiki-link";', "Top 100 warmed link imports artist wiki link helper", failures);
  assertContains(top100LinkSource, '<ArtistWikiLink artistName={track.channelTitle} videoId={track.id} className="artistInlineLink">', "Top 100 warmed link wraps artist name with wiki link", failures);

  // Top 100 ranking must use favourite counts, not a boolean one-favourite flag.
  assertContains(catalogDataSource, "WHERE v.videoId REGEXP '^[A-Za-z0-9_-]{11}$'", "Top 100 pool filters to valid YouTube ids", failures);
  assertContains(catalogDataSource, "ORDER BY v.favourited DESC, COALESCE(v.viewCount, 0) DESC, v.videoId ASC", "Top 100 pool ranks by favourite count first", failures);
  assertContains(catalogDataSource, "await prisma.video.updateMany({", "Favourite mutations persist favourite counts back to videos", failures);
  assertContains(catalogDataSource, "data: { favourited: favouriteCount },", "Favourite mutations store recalculated favourite totals", failures);
  assertContains(catalogDataSource, 'const { invalidateTopVideosCache } = await import("@/lib/top-videos-cache");', "Favourite mutations can invalidate Top 100 API cache", failures);
  assertContains(catalogDataSource, "invalidateTopVideosCache();", "Favourite mutations invalidate Top 100 API cache after updates", failures);

  // Resolver deadlock fix invariants for denied responses and in-flight short-circuit guard.
  assertContains(shellDynamicSource, "if (data?.denied?.message) {", "Requested-video resolver handles denied payload branch", failures);
  assertContains(shellDynamicSource, "setIsResolvingRequestedVideo(false);", "Denied branch clears requested-video resolving state", failures);
  assertContains(shellDynamicSource, "currentVideo.id === requestedVideoId", "In-flight short-circuit guard checks current video id", failures);
  assertContains(shellDynamicSource, "!isResolvingRequestedVideo", "In-flight short-circuit guard checks resolver state", failures);

  // Watch Next rail and sparse-related fallback padding invariants.
  assertContains(shellDynamicSource, "Watch Next", "Player shell labels related rail as Watch Next", failures);
  assertContains(currentVideoRouteSource, "getTopVideos", "Current video route imports top videos for related fallback", failures);
  assertContains(currentVideoRouteSource, "relatedVideos.length < targetRelatedCount", "Current video route pads sparse related list", failures);
  assertContains(currentVideoRouteSource, "const targetRelatedCount = 10;", "Current video route pads Watch Next up to 10 items", failures);
  assertContains(currentVideoRouteSource, "new Set([currentVideo.id, ...relatedVideos.map((video) => video.id)])", "Current video route excludes current and existing related ids from filler", failures);
  assertContains(currentVideoRouteSource, "paddedRelatedVideos = [...relatedVideos, ...filler];", "Current video route appends randomized filler items", failures);
  assertContains(shellDynamicSource, "const watchNextRailRef = useRef<HTMLElement | null>(null);", "Watch Next rail has a dedicated ref for scroll control", failures);
  assertContains(shellDynamicSource, "watchNextRailRef.current.scrollTop = 0;", "Watch Next rail resets to top when reloading", failures);
  assertContains(shellDynamicSource, "ref={watchNextRailRef}", "Watch Next rail element is bound to the scroll ref", failures);

  // Leaderboard row hover styling must match other video cards.
  assertContains(globalCssSource, ".trackCard.leaderboardCard {", "Leaderboard card rows have scoped transition styles", failures);
  assertContains(globalCssSource, ".trackCard.leaderboardCard:hover {", "Leaderboard card rows turn red on hover", failures);
  assertContains(globalCssSource, "rgba(170, 30, 17", "Leaderboard hover uses the standard red gradient", failures);
  assertContains(globalCssSource, ".artistInlineLink", "Leaderboard rows reuse inline artist wiki link styling", failures);

  if (failures.length > 0) {
    console.error("Top 100 UI invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Top 100 UI invariant check passed.");
}

main();
