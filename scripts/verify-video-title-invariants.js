#!/usr/bin/env node

/**
 * Video-title single-source-of-truth invariant check.
 *
 * Guards the fix for the "wrong title in the tab/player" bug:
 *
 *  1. The player title must be derived from the raw `videos.title` field,
 *     never reconstructed from `parsedArtist - parsedTrack`.
 *  2. Both player overlay title sites must render `displayTitle`.
 *  3. Single-video lookups must order by `COALESCE(approved, 0) DESC` so the
 *     metadata path and the shell/player path resolve the same duplicate row.
 *  4. The tab-title hook must only write the title once currentVideo matches
 *     the requested id, and must track the exact written title.
 *  5. Pending-selection optimistic merges must never mix another video's
 *     title onto the requested id.
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
  shell: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  titleHook: path.join(ROOT, "apps/web/hooks/use-video-page-title.ts"),
  adminEditHook: path.join(ROOT, "apps/web/hooks/use-admin-video-edit.ts"),
  catalogDb: path.join(ROOT, "apps/web/lib/catalog-data-db.ts"),
  pendingSelection: path.join(ROOT, "apps/web/lib/pending-video-selection.ts"),
};

function countOccurrences(source, needle) {
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + 1);
  }
  return count;
}

function main() {
  const failures = [];

  const player = readFileStrict(files.player, ROOT);
  const shell = readFileStrict(files.shell, ROOT);
  const titleHook = readFileStrict(files.titleHook, ROOT);
  const adminEditHook = readFileStrict(files.adminEditHook, ROOT);
  const catalogDb = readFileStrict(files.catalogDb, ROOT);
  const pendingSelection = readFileStrict(files.pendingSelection, ROOT);

  // ── Player title is the raw `title` field ─────────────────────────────────
  assertContains(
    player,
    "const displayTitle = rawDisplayTitle.trim();",
    "Player derives displayTitle from the raw title field (single source of truth)",
    failures,
  );
  const overlayTitleSites = countOccurrences(player, '<p className="overlayTitle">{displayTitle}</p>');
  if (overlayTitleSites < 2) {
    failures.push(
      `Both player overlay title sites must render displayTitle (found ${overlayTitleSites})`,
    );
  }
  assertNotContains(
    player,
    "${parsedArtistCandidate} - ${parsedTrackCandidate}",
    "Player no longer reconstructs the title from parsedArtist - parsedTrack",
    failures,
  );
  assertNotContains(
    player,
    "overlayArtistLabel",
    "Player overlay no longer renders the parsed-artist label as the title",
    failures,
  );
  assertNotContains(
    player,
    "parsedTrackCandidate",
    "Player no longer derives the displayed title from parsedTrack",
    failures,
  );
  assertContains(
    player,
    "overlayArtistHref",
    "Player overlay keeps the artist link so users can browse more tracks by the artist",
    failures,
  );
  assertContains(
    player,
    '<Link href={overlayArtistHref} className="overlayArtistLink">',
    "Both player overlay sites render the artist link",
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

  // ── Admin edit callback no longer carries parsed-track for title display ──
  assertContains(
    adminEditHook,
    "onSaveSuccess: (title: string, channelTitle: string, parsedArtist: string, genre: string) => void;",
    "Admin save callback no longer propagates parsed-track for title display",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Video-title invariant failures:",
    successMessage: "Video-title invariants OK — single source of truth preserved.",
  });
}

main();
