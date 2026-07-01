#!/usr/bin/env node

// Domain: Forum — threads, posts, embedded video player, and post content rendering.
// Covers: forum thread page, post card layout, forum post content component,
// embedded video player CSS, and the post-content whitespace fix.

const path = require("node:path");
const fs = require("node:fs");
const {
  readFileStrict,
  collectCssFiles,
  assertContains,
  assertCssRuleContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

  const files = {
    threadPage: path.join(ROOT, "apps/web/app/(shell)/forum/thread/[slug]/page.tsx"),
    forumThreadContent: path.join(ROOT, "apps/web/components/forum-thread-content.tsx"),
    forumPostContent: path.join(ROOT, "apps/web/components/forum-post-content.tsx"),
    forumVideoEmbed: path.join(ROOT, "apps/web/components/forum-video-embed.tsx"),
    forumPageContent: path.join(ROOT, "apps/web/components/forum-page-content.tsx"),
    forumData: path.join(ROOT, "apps/web/lib/forum-data.ts"),
    forumThreadsApi: path.join(ROOT, "apps/web/app/api/forum/threads/route.ts"),
    forumVoteApi: path.join(ROOT, "apps/web/app/api/forum/threads/[threadId]/vote/route.ts"),
    prismaSchema: path.join(ROOT, "prisma/schema.prisma"),
    migrationDir: path.join(ROOT, "prisma/migrations/20260630_add_track_battle_fields"),
    cssRoot: path.join(ROOT, "apps/web/app"),
  };

function main() {
  const failures = [];

  // --- Source files ---
  const threadPageSource = readFileStrict(files.threadPage, ROOT);
  const forumThreadContentSource = readFileStrict(files.forumThreadContent, ROOT);
  const forumPostContentSource = readFileStrict(files.forumPostContent, ROOT);
  const forumVideoEmbedSource = readFileStrict(files.forumVideoEmbed, ROOT);
  const forumPageContentSource = readFileStrict(files.forumPageContent, ROOT);
  const forumDataSource = readFileStrict(files.forumData, ROOT);
  const forumThreadsApiSource = readFileStrict(files.forumThreadsApi, ROOT);
  const forumVoteApiSource = readFileStrict(files.forumVoteApi, ROOT);
  const prismaSchemaSource = readFileStrict(files.prismaSchema, ROOT);
  const cssSource = collectCssFiles(files.cssRoot)
    .map((filePath) => readFileStrict(filePath, ROOT))
    .join("\n");

  // --- File existence ---
  for (const [key, filePath] of Object.entries(files)) {
    if (key === "cssRoot") continue;
    if (!fs.existsSync(filePath)) {
      failures.push(`Required file missing: ${path.relative(ROOT, filePath)} (${key})`);
    }
  }

  // --- Thread page ---
  assertContains(
    threadPageSource,
    "ForumThreadContent",
    "Thread page renders ForumThreadContent",
    failures,
  );
  assertContains(
    threadPageSource,
    "getThreadDetail",
    "Thread page calls getThreadDetail for server-side data",
    failures,
  );

  // --- ForumThreadContent component ---
  assertContains(
    forumThreadContentSource,
    "forumPostCard",
    "ForumThreadContent renders post cards with forumPostCard class",
    failures,
  );
  assertContains(
    forumThreadContentSource,
    "ForumPostContent",
    "ForumThreadContent renders ForumPostContent for post content",
    failures,
  );
  assertContains(
    forumThreadContentSource,
    "forumPostCardOpening",
    "Opening post receives forumPostCardOpening class",
    failures,
  );

  // --- ForumPostContent component ---
  assertContains(
    forumPostContentSource,
    "ForumVideoEmbed",
    "ForumPostContent imports ForumVideoEmbed",
    failures,
  );
  assertContains(
    forumPostContentSource,
    "[video:",
    "ForumPostContent parses [video:ID] tags from content",
    failures,
  );
  assertContains(
    forumPostContentSource,
    'type: "video"',
    "ForumPostContent yields video-typed parts for embedded players",
    failures,
  );

  // --- ForumVideoEmbed component ---
  assertContains(
    forumVideoEmbedSource,
    "forumEmbeddedPlayer",
    "ForumVideoEmbed renders with forumEmbeddedPlayer CSS class",
    failures,
  );
  assertContains(
    forumVideoEmbedSource,
    "PlayerExperience",
    "ForumVideoEmbed renders PlayerExperience component",
    failures,
  );
  assertContains(
    forumVideoEmbedSource,
    "suppressAuthWall={true}",
    "ForumVideoEmbed suppresses auth wall for guest viewing",
    failures,
  );
  assertContains(
    forumVideoEmbedSource,
    "stopOnEnd={true}",
    "ForumVideoEmbed stops player on video end",
    failures,
  );

  // --- forum-data module ---
  assertContains(
    forumDataSource,
    "getThreadDetail",
    "forum-data exports getThreadDetail",
    failures,
  );

  // --- CSS: Embedded video player ---
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer",
    "transform: scale(.65)",
    "Embedded player uses scale(0.65) for visual sizing",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer",
    "aspect-ratio: 16 / 9",
    "Embedded player maintains 16:9 aspect ratio",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer",
    "margin: 8px 0",
    "Embedded player has 8px vertical margin",
    failures,
  );

  // CSS: Player chrome within embed
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer .playerChrome",
    "height: 100%",
    "Embedded player chrome fills the container",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer .playerDockLayer",
    "height: 100%",
    "Embedded player dock layer fills the container",
    failures,
  );

  // CSS: Suppressed UI elements in embed
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer .overlayDockCloseBtn",
    "display: none",
    "Embedded player hides dock close button",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer .playerFooterReserve",
    "display: none",
    "Embedded player hides footer reserve space",
    failures,
  );

  // CSS: Overlay title stack margin isolation
  assertCssRuleContains(
    cssSource,
    ".forumEmbeddedPlayer .overlayTitleStack p",
    "margin: 0",
    "Embedded player isolates overlay title from post content p margins",
    failures,
  );

  // --- CSS: Whitespace fix (post-content :has rule) ---
  assertCssRuleContains(
    cssSource,
    ".forumPostContent:has(.forumEmbeddedPlayer)",
    "margin-bottom: calc(-19.6875%)",
    "Post content with embedded video collapses extra layout height from scale transform",
    failures,
  );

  // --- CSS: Post card layout ---
  assertCssRuleContains(
    cssSource,
    ".forumPostCard",
    "padding: 16px",
    "Forum post card has 16px padding",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumPostCardMain",
    "display: flex",
    "Forum post card main uses flex layout",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumPostContent p",
    "margin: 0 0 8px",
    "Forum post content paragraphs have 8px bottom margin",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumPostContent p:last-child",
    "margin-bottom: 0",
    "Last paragraph in post content has zero bottom margin",
    failures,
  );

  // ── Track Battle invariants ──────────────────────────────────────────────────

  // --- DB schema ---
  assertContains(
    prismaSchemaSource,
    "model ForumVote",
    "Prisma schema defines ForumVote model",
    failures,
  );
  assertContains(
    prismaSchemaSource,
    "video1_id",
    "Prisma ForumThread includes video1_id column",
    failures,
  );
  assertContains(
    prismaSchemaSource,
    "video2_id",
    "Prisma ForumThread includes video2_id column",
    failures,
  );
  assertContains(
    prismaSchemaSource,
    "uq_forum_vote_thread_user",
    "ForumVote has unique constraint on (thread_id, user_id)",
    failures,
  );
  assertContains(
    prismaSchemaSource,
    "votes     ForumVote[]",
    "ForumThread has votes relation to ForumVote",
    failures,
  );

  // --- Migration file ---
  if (!fs.existsSync(path.join(files.migrationDir, "migration.sql"))) {
    failures.push("Track battle migration file missing: prisma/migrations/20260630_add_track_battle_fields/migration.sql");
  }

  // --- forum-data: new exports ---
  assertContains(
    forumDataSource,
    "getVoteCounts",
    "forum-data exports getVoteCounts function",
    failures,
  );
  assertContains(
    forumDataSource,
    "getUserVote",
    "forum-data exports getUserVote function",
    failures,
  );
  assertContains(
    forumDataSource,
    "castVote",
    "forum-data exports castVote function",
    failures,
  );
  assertContains(
    forumDataSource,
    "ThreadVoteCounts",
    "forum-data exports ThreadVoteCounts type",
    failures,
  );

  // --- forum-data: vote SQL ---
  assertContains(
    forumDataSource,
    "ON DUPLICATE KEY UPDATE vote = VALUES(vote)",
    "castVote uses upsert for idempotent voting",
    failures,
  );

  // --- forum-data: thread detail returns voteCounts ---
  assertContains(
    forumDataSource,
    "voteCounts",
    "getThreadDetail returns voteCounts in result",
    failures,
  );

  // --- forum-data: createThread accepts video IDs ---
  assertContains(
    forumDataSource,
    "video1Id?: string | null",
    "createThread accepts optional video1Id parameter",
    failures,
  );
  assertContains(
    forumDataSource,
    "video2Id?: string | null",
    "createThread accepts optional video2Id parameter",
    failures,
  );

  // --- forum-data: raw row type includes video columns ---
  assertContains(
    forumDataSource,
    "video1_id: string | null",
    "RawThreadRow type includes video1_id",
    failures,
  );
  assertContains(
    forumDataSource,
    "video2_id: string | null",
    "RawThreadRow type includes video2_id",
    failures,
  );

  // --- forum-data: queries include video columns ---
  assertContains(
    forumDataSource,
    "t.video1_id",
    "SQL queries select t.video1_id",
    failures,
  );
  assertContains(
    forumDataSource,
    "t.video2_id",
    "SQL queries select t.video2_id",
    failures,
  );

  // --- forum-data: ForumThreadSummary includes video fields ---
  assertContains(
    forumDataSource,
    "video1Id: string | null;",
    "ForumThreadSummary type includes video1Id",
    failures,
  );
  assertContains(
    forumDataSource,
    "video2Id: string | null;",
    "ForumThreadSummary type includes video2Id",
    failures,
  );

  // --- Thread page: calls incrementThreadViewCount ---
  assertContains(
    threadPageSource,
    "incrementThreadViewCount",
    "Thread page imports and calls incrementThreadViewCount",
    failures,
  );

  // --- ForumThreadContent: TrackBattleHeader component ---
  assertContains(
    forumThreadContentSource,
    "TrackBattleHeader",
    "ForumThreadContent defines TrackBattleHeader component",
    failures,
  );
  assertContains(
    forumThreadContentSource,
    "isTrackBattle",
    "ForumThreadContent checks isTrackBattle condition",
    failures,
  );
  assertContains(
    forumThreadContentSource,
    'thread.sectionId === "track-battles"',
    "ForumThreadContent detects track-battles section",
    failures,
  );
  assertContains(
    forumThreadContentSource,
    "forumBattleHeader",
    "TrackBattleHeader renders with forumBattleHeader CSS class",
    failures,
  );
  assertContains(
    forumThreadContentSource,
    "forumBattleVoteButton",
    "TrackBattleHeader has vote buttons",
    failures,
  );
  assertContains(
    forumThreadContentSource,
    "/api/forum/threads/${threadId}/vote",
    "TrackBattleHeader fetches vote data from API",
    failures,
  );

  // --- ForumPageContent: track battle form fields ---
  assertContains(
    forumPageContentSource,
    'selectedSectionId === "track-battles"',
    "ForumPageContent detects track-battles section for form",
    failures,
  );
  assertContains(
    forumPageContentSource,
    'name="video1"',
    "New thread form includes video1 input for track battles",
    failures,
  );
  assertContains(
    forumPageContentSource,
    'name="video2"',
    "New thread form includes video2 input for track battles",
    failures,
  );
  assertContains(
    forumPageContentSource,
    "video1Id",
    "New thread form sends video1Id in API request",
    failures,
  );
  assertContains(
    forumPageContentSource,
    "video2Id",
    "New thread form sends video2Id in API request",
    failures,
  );

  // --- API: threads route accepts video IDs ---
  assertContains(
    forumThreadsApiSource,
    "video1Id?: string",
    "POST /api/forum/threads accepts optional video1Id",
    failures,
  );
  assertContains(
    forumThreadsApiSource,
    "video2Id?: string",
    "POST /api/forum/threads accepts optional video2Id",
    failures,
  );
  assertContains(
    forumThreadsApiSource,
    "createThread(sectionId, title, authState.user.id, content, video1Id, video2Id)",
    "POST /api/forum/threads passes video IDs to createThread",
    failures,
  );

  // --- API: vote route ---
  assertContains(
    forumVoteApiSource,
    "castVote",
    "Vote API route imports castVote",
    failures,
  );
  assertContains(
    forumVoteApiSource,
    "getVoteCounts",
    "Vote API route imports getVoteCounts",
    failures,
  );
  assertContains(
    forumVoteApiSource,
    "getUserVote",
    "Vote API route imports getUserVote",
    failures,
  );
  assertContains(
    forumVoteApiSource,
    '"Authentication required"',
    "Vote POST requires authentication",
    failures,
  );
  assertContains(
    forumVoteApiSource,
    '"Vote must be 1 or 2"',
    "Vote POST validates vote is 1 or 2",
    failures,
  );

  // --- CSS: Battle header styles ---
  assertCssRuleContains(
    cssSource,
    ".forumBattleHeader",
    "margin-bottom: 14px",
    "Battle header has bottom margin",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumBattleVideos",
    "display: flex",
    "Battle videos container uses flex layout",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumBattleVs",
    "font-family",
    "VS divider uses display font",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumBattleVoteButtonActive",
    "linear-gradient(180deg, rgba(60, 160, 60, 0.5)",
    "Active vote button has green gradient",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumBattleVoteFill",
    "transition: width 0.4s ease",
    "Vote fill bar animates width transitions",
    failures,
  );
  assertCssRuleContains(
    cssSource,
    ".forumBattleVideoVoted",
    "rgba(220, 90, 60, 0.06)",
    "Voted video panel has subtle red tint",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Forum invariant check failed.",
    successMessage: "Forum invariant check passed.",
  });
}

main();
