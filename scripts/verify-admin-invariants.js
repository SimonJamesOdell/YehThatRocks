#!/usr/bin/env node

const path = require("node:path");
const { readFileStrict, assertContains } = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  adminAuth: path.join(ROOT, "apps/web/lib/admin-auth.ts"),
  accountPage: path.join(ROOT, "apps/web/app/(shell)/account/page.tsx"),
  adminPage: path.join(ROOT, "apps/web/app/(shell)/admin/page.tsx"),
  adminDashboardRoute: path.join(ROOT, "apps/web/app/api/admin/dashboard/route.ts"),
  adminCategoriesRoute: path.join(ROOT, "apps/web/app/api/admin/categories/route.ts"),
  adminVideosRoute: path.join(ROOT, "apps/web/app/api/admin/videos/route.ts"),
  adminArtistsRoute: path.join(ROOT, "apps/web/app/api/admin/artists/route.ts"),
  adminDashboardPanel: path.join(ROOT, "apps/web/components/admin-dashboard-panel.tsx"),
  catalogData: path.join(ROOT, "apps/web/lib/catalog-data-core.ts"),
  currentVideoCache: path.join(ROOT, "apps/web/lib/current-video-cache.ts"),
};

function main() {
  const failures = [];

  const adminAuthSource = readFileStrict(files.adminAuth, ROOT);
  const accountPageSource = readFileStrict(files.accountPage, ROOT);
  const adminPageSource = readFileStrict(files.adminPage, ROOT);
  const adminDashboardRouteSource = readFileStrict(files.adminDashboardRoute, ROOT);
  const adminCategoriesRouteSource = readFileStrict(files.adminCategoriesRoute, ROOT);
  const adminVideosRouteSource = readFileStrict(files.adminVideosRoute, ROOT);
  const adminArtistsRouteSource = readFileStrict(files.adminArtistsRoute, ROOT);
  const adminDashboardPanelSource = readFileStrict(files.adminDashboardPanel, ROOT);
  const catalogDataSource = readFileStrict(files.catalogData, ROOT);
  const currentVideoCacheSource = readFileStrict(files.currentVideoCache, ROOT);

  // Admin identity and auth guard invariants.
  assertContains(adminAuthSource, 'const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "simonjamesodell@live.co.uk").trim().toLowerCase();', "Admin auth pins owner email with env override", failures);
  assertContains(adminAuthSource, 'const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID ?? "");', "Admin auth reads optional admin user id from env", failures);
  assertContains(adminAuthSource, "const ENFORCE_ADMIN_USER_ID = Number.isInteger(ADMIN_USER_ID) && ADMIN_USER_ID > 0;", "Admin auth conditionally enforces user-id lock", failures);
  assertContains(adminAuthSource, "export function isAdminIdentity", "Admin auth exposes shared identity helper", failures);
  assertContains(adminAuthSource, "export async function requireAdminApiAuth", "Admin API routes are guardable with requireAdminApiAuth", failures);
  assertContains(adminAuthSource, 'response: NextResponse.json({ error: "Forbidden" }, { status: 403 })', "Admin API guard returns 403 for non-admin users", failures);
  assertContains(adminAuthSource, "export async function requireAdminUser()", "Admin page can enforce server-side admin user checks", failures);

  // Account page entry-point invariants.
  assertContains(accountPageSource, 'import { isAdminIdentity } from "@/lib/admin-auth";', "Account page reuses centralized admin identity logic", failures);
  assertContains(accountPageSource, "const isAdminUser = Boolean(user && isAdminIdentity(user.id, user.email ?? \"\"));", "Account page computes admin visibility from shared helper", failures);
  assertContains(accountPageSource, '<Link href="/admin" className="favouritesBlindClose">Admin Panel</Link>', "Account top bar renders admin button for admin user", failures);
  assertContains(accountPageSource, "className=\"accountTopBarActions\"", "Account page keeps grouped top bar actions", failures);

  // Admin page and API security invariants.
  assertContains(adminPageSource, "const adminAuthState = await requireAdminUserAuthState();", "Admin page enforces server-side admin auth-state checks", failures);
  assertContains(adminPageSource, "adminAuthState.status === \"authorized\"", "Admin page gates dashboard rendering on authorized admin status", failures);
  assertContains(adminPageSource, "<AdminDashboardPanel activeTab={activeTab} />", "Admin page renders dashboard for authorized user", failures);
  assertContains(adminPageSource, "Admin access required", "Admin page shows explicit denial state for unauthorized users", failures);

  assertContains(adminDashboardRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin dashboard API requires admin auth", failures);
  assertContains(adminCategoriesRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin categories API requires admin auth", failures);
  assertContains(adminVideosRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin videos API requires admin auth", failures);
  assertContains(adminArtistsRouteSource, "const auth = await requireAdminApiAuth(request);", "Admin artists API requires admin auth", failures);

  // Mutating endpoints must keep CSRF protection.
  assertContains(adminCategoriesRouteSource, "const csrf = verifySameOrigin(request);", "Admin categories PATCH enforces CSRF", failures);
  assertContains(adminVideosRouteSource, "const csrf = verifySameOrigin(request);", "Admin videos PATCH enforces CSRF", failures);
  assertContains(adminArtistsRouteSource, "const csrf = verifySameOrigin(request);", "Admin artists PATCH enforces CSRF", failures);

  // Admin videos/artists APIs use Prisma models and explicit selects.
  assertContains(adminVideosRouteSource, "const videos = await prisma.video.findMany({", "Admin videos API reads via Prisma video model", failures);
  assertContains(adminVideosRouteSource, "orderBy: [{ updatedAt: \"desc\" }, { id: \"desc\" }]", "Admin videos API keeps deterministic recency ordering", failures);
  assertContains(adminVideosRouteSource, "description: true,", "Admin videos API includes description in GET payload", failures);
  assertContains(adminVideosRouteSource, 'import { clearCatalogVideoCaches, pruneVideoAndAssociationsByVideoId } from "@/lib/catalog-data";', "Admin videos API imports shared catalog cache invalidation helper", failures);
  assertContains(adminVideosRouteSource, 'import { clearCurrentVideoRouteCaches } from "@/lib/current-video-cache";', "Admin videos API imports shared current-video cache invalidation helper", failures);
  assertContains(adminVideosRouteSource, "clearCatalogVideoCaches();", "Admin videos PATCH clears catalog-side video caches after metadata edits", failures);
  assertContains(adminVideosRouteSource, "clearCurrentVideoRouteCaches();", "Admin videos PATCH clears current-video route caches after metadata edits", failures);
  assertContains(adminVideosRouteSource, "const pruneResult = await pruneVideoAndAssociationsByVideoId(parsed.data.videoId, \"admin-hard-delete\");", "Admin videos DELETE prunes catalog data via shared hard-delete helper", failures);
  assertContains(adminVideosRouteSource, "if (!pruneResult.pruned)", "Admin videos DELETE handles prune failures explicitly", failures);
  assertContains(adminVideosRouteSource, "return NextResponse.json({ error: \"Could not delete video\", reason: pruneResult.reason }, { status: 409 });", "Admin videos DELETE returns structured prune failure reason payload", failures);
  assertContains(adminVideosRouteSource, "clearCurrentVideoRouteCaches();", "Admin videos DELETE clears current-video route caches after successful deletion", failures);
  assertContains(adminVideosRouteSource, "return NextResponse.json({ ok: true, deletedVideoRows: pruneResult.deletedVideoRows });", "Admin videos DELETE returns deleted row count on success", failures);
  assertContains(adminArtistsRouteSource, "const artists = await prisma.artist.findMany({", "Admin artists API reads via Prisma artist model", failures);
  assertContains(adminArtistsRouteSource, "orderBy: { name: \"asc\" }", "Admin artists API keeps alphabetical ordering", failures);

  // Admin overview analytics refresh invariants.
  assertContains(adminDashboardPanelSource, "const ANALYTICS_AUTO_REFRESH_MS = 5 * 60 * 1000;", "Admin dashboard defines 5-minute analytics auto-refresh interval", failures);
  assertContains(adminDashboardPanelSource, "const refreshOverviewAnalytics = useCallback(async () => {", "Admin dashboard uses a shared overview refresh helper", failures);
  assertContains(adminDashboardPanelSource, "if (activeTab !== \"overview\") {", "Admin dashboard only auto-refreshes while overview tab is active", failures);
  assertContains(adminDashboardPanelSource, "if (cancelled || refreshing || document.hidden) {", "Admin dashboard skips background auto-refresh for hidden tabs and in-flight refreshes", failures);
  assertContains(adminDashboardPanelSource, "window.setInterval(() => {", "Admin dashboard schedules periodic analytics refresh", failures);
  assertContains(adminDashboardPanelSource, "}, ANALYTICS_AUTO_REFRESH_MS);", "Admin dashboard interval uses the 5-minute refresh constant", failures);
  assertContains(adminDashboardPanelSource, "void refreshOverviewAnalytics();", "Admin dashboard manual refresh button reuses shared refresh helper", failures);

  // Shared cache helpers must exist so admin edit invalidation is centralized.
  assertContains(catalogDataSource, "export function clearCatalogVideoCaches()", "Catalog data exposes shared video cache clear helper", failures);
  assertContains(catalogDataSource, "relatedVideosCache.clear();", "Catalog cache helper clears related video cache", failures);
  assertContains(catalogDataSource, "if (reason === \"admin-hard-delete\") {", "Catalog prune helper handles admin hard-delete reason", failures);
  assertContains(catalogDataSource, "${\"admin-deleted\"}", "Catalog prune helper writes admin-deleted rejection reason", failures);
  assertContains(currentVideoCacheSource, "export function clearCurrentVideoRouteCaches()", "Current-video cache module exposes shared route cache clear helper", failures);
  assertContains(currentVideoCacheSource, "currentVideoRelatedPoolCache.clear();", "Current-video cache helper clears related pool cache", failures);

  if (failures.length > 0) {
    console.error("Admin invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Admin invariant check passed.");
}

main();
