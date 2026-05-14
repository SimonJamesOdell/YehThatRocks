#!/usr/bin/env node

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  finishInvariantCheck,
} = require("./invariants/helpers");

const ROOT = process.cwd();

const files = {
  articlePage: path.join(ROOT, "apps/web/app/(shell)/magazine/[slug]/page.tsx"),
  articleCommentsComponent: path.join(ROOT, "apps/web/components/magazine-article-comments.tsx"),
  articleCommentsRoute: path.join(ROOT, "apps/web/app/api/magazine/[slug]/comments/route.ts"),
  adminCommentsRoute: path.join(ROOT, "apps/web/app/api/admin/magazine/comments/route.ts"),
  adminCommentsModerateRoute: path.join(ROOT, "apps/web/app/api/admin/magazine/comments/moderate/route.ts"),
  adminMagazineTab: path.join(ROOT, "apps/web/components/admin-dashboard-magazine-tab.tsx"),
  adminPanel: path.join(ROOT, "apps/web/components/admin-dashboard-panel.tsx"),
  moderationHelper: path.join(ROOT, "apps/web/lib/magazine-comment-moderation.ts"),
};

function main() {
  const failures = [];

  const articlePageSource = readFileStrict(files.articlePage, ROOT);
  const articleCommentsComponentSource = readFileStrict(files.articleCommentsComponent, ROOT);
  const articleCommentsRouteSource = readFileStrict(files.articleCommentsRoute, ROOT);
  const adminCommentsRouteSource = readFileStrict(files.adminCommentsRoute, ROOT);
  const adminCommentsModerateRouteSource = readFileStrict(files.adminCommentsModerateRoute, ROOT);
  const adminMagazineTabSource = readFileStrict(files.adminMagazineTab, ROOT);
  const adminPanelSource = readFileStrict(files.adminPanel, ROOT);
  const moderationHelperSource = readFileStrict(files.moderationHelper, ROOT);

  assertContains(articlePageSource, "<MagazineArticleComments slug={article.slug} />", "Magazine article page renders comments block", failures);
  assertContains(articleCommentsComponentSource, "export function MagazineArticleComments", "Magazine comments client component exists", failures);
  assertContains(articleCommentsRouteSource, "export async function GET", "Article comments API exposes GET", failures);
  assertContains(articleCommentsRouteSource, "export async function POST", "Article comments API exposes POST", failures);
  assertContains(articleCommentsRouteSource, 'moderationStatus = moderation.shouldReview ? "pending_review" : "public"', "Comment submission stores moderation status", failures);
  assertContains(articleCommentsRouteSource, "Comment submitted for review.", "Flagged submissions return review notice", failures);
  assertContains(adminCommentsRouteSource, "export async function GET", "Admin magazine comments queue exposes GET", failures);
  assertContains(adminCommentsModerateRouteSource, "action: z.enum([\"approve\", \"keep_restricted\", \"delete_comment\", \"delete_user\"])", "Admin moderation route enforces action enum", failures);
  assertContains(adminMagazineTabSource, "Comment Moderation Queue", "Admin magazine tab renders comment moderation queue", failures);
  assertContains(adminPanelSource, "loadMagazineCommentQueue", "Admin panel loads magazine moderation queue", failures);
  assertContains(adminPanelSource, "moderateMagazineComment", "Admin panel exposes magazine comment moderation action", failures);
  assertContains(moderationHelperSource, "export async function classifyMagazineComment", "Comment moderation helper exposes classifier", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Magazine comments invariant check failed.",
    successMessage: "Magazine comments invariant check passed.",
  });
}

main();
