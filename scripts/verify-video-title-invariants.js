#!/usr/bin/env node

/**
 * Video-title single-source-of-truth invariant check.
 *
 * Guards the title-display contract:
 *
 *  1. Artist + track fields are the single source of truth for the displayed
 *     title everywhere — the player overlay, the video cards, and the
 *     browser-tab/page title all derive from them via buildVideoDisplayTitle.
 *  2. The raw `videos.title` field is only shown on the transient
 *     "Now playing" overlay at the start of playback.
 *  3. The player overlay keeps the artist name as a link to the artist page.
 *  4. Single-video lookups order by `COALESCE(approved, 0) DESC` so the
 *     metadata path and the shell/player path resolve the same duplicate row.
 *  5. The tab-title hook only writes once currentVideo matches the requested
 *     id, and tracks the exact written title.
 *  6. Pending-selection optimistic merges never mix another video's title
 *     onto the requested id.
 */

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  player: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  page: path.join(ROOT, "apps/web/app/(shell)/page.tsx"),
  shell: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  titleHook: path.join(ROOT, "apps/web/hooks/use-video-page-title.ts"),
  adminEditHook: path.join(ROOT, "apps/web/hooks/use-admin-video-edit.ts"),
  catalogDb: path.join(ROOT, "apps/web/lib/catalog-data-db.ts"),
  pendingSelection: path.join(ROOT, "apps/web/lib/pending-video-selection.ts"),
  displayTitle: path.join(ROOT, "apps/web/lib/video-display-title.ts"),
};

function main() {
  const failures = [];

  const player = readFileStrict(files.player, ROOT);
  const page = readFileStrict(files.page, ROOT);
  const shell = readFileStrict(files.shell, ROOT);
  const titleHook = readFileStrict(files.titleHook, ROOT);
  const adminEditHook = readFileStrict(files.adminEditHook, ROOT);
  const catalogDb = readFileStrict(files.catalogDb, ROOT);
  const pendingSelection = readFileStrict(files.pendingSelection, ROOT);
  const displayTitle = readFileStrict(files.displayTitle, ROOT);

  // ── Shared display-title helper is the single source of truth ─────────────
  assertContains(
    displayTitle,
    "export function buildVideoDisplayTitle",
    "A shared helper derives the display title from artist + track fields",
    failures,
  );
  assertContains(
    displayTitle,
    "return `${parsedArtist} - ${parsedTrack}`;",
    "Display title is reconstructed from the artist and track fields",
    failures,
  );

  // ── Player overlay uses artist + track with a clickable artist link ───────
  assertContains(
    player,
    "buildVideoDisplayTitle(",
    "Player derives displayTitle through the shared artist+track helper",
    failures,
  );
  assertContains(
    player,
    '<Link href={overlayArtistHref} className="overlayArtistLink">',
    "Player overlay renders the artist as a link to the artist page",
    failures,
  );
  assertContains(
    player,
    "{overlayTrackLabel}",
    "Player overlay renders the track label next to the artist link",
    failures,
  );
  assertNotContains(
    player,
    '<p className="overlayTitle">{displayTitle}</p>',
    "Player overlay must not render the raw title as the top-of-player title",
    failures,
  );

  // ── Raw title is only shown on the transient Now-playing overlay ──────────
  assertContains(
    player,
    "<strong>{rawDisplayTitle.trim()}</strong>",
    "The raw title field is shown only on the start-of-playback Now-playing overlay",
    failures,
  );

  // ── Page/tab title derives from artist + track ────────────────────────────
  assertContains(
    page,
    "buildVideoDisplayTitle(",
    "Server metadata derives the page/tab title through the shared helper",
    failures,
  );
  assertContains(
    titleHook,
    "buildVideoDisplayTitle(",
    "Client tab-title hook derives the title through the shared helper",
    failures,
  );

  // ── Deterministic duplicate-row resolution ────────────────────────────────
  assertContains(
    catalogDb,
    "COALESCE(v.approved, 0) DESC",
    "Single-video lookups order by approved first (same row as the metadata path)",
    failures,
  );
  assertContains(
    catalogDb,
    "export function buildVideoByIdOrderByClause",
    "Approved-first ordering lives in a dedicated, testable helper",
    failures,
  );

  // ── Tab-title hook guard ───────────────────────────────────────────────────
  assertContains(
    titleHook,
    "if (requestedVideoId && currentVideo.id !== requestedVideoId)",
    "Tab-title hook preserves the server title until currentVideo matches the requested id",
    failures,
  );
  assertContains(
    titleHook,
    "const nextTitle = `${videoTitle} | ${SHARE_SITE_NAME}`;",
    "Tab-title hook tracks the exact written title so edits re-sync",
    failures,
  );

  // ── Pending-selection optimistic merge guard ──────────────────────────────
  assertContains(
    shell,
    "buildOptimisticVideoFromPendingSelection(",
    "Shell resolves pending selections through the optimistic-video helper",
    failures,
  );
  assertNotContains(
    shell,
    "title: typeof pendingSelection.title === \"string\" ? pendingSelection.title : previousVideo.title",
    "Shell no longer merges a missing pending title onto the requested id",
    failures,
  );
  assertContains(
    pendingSelection,
    "if (pendingTitle.length === 0)",
    "Optimistic-video helper rejects selections without a real title",
    failures,
  );

  // ── Admin edit callback carries the parsed-track field for display ─────────
  assertContains(
    adminEditHook,
    "onSaveSuccess: (title: string, channelTitle: string, parsedArtist: string, parsedTrack: string, genre: string) => void;",
    "Admin save callback propagates parsed-track so the player title stays consistent",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Video-title invariant failures:",
    successMessage: "Video-title invariants OK — artist + track fields are the single source of truth.",
  });
}

main();
