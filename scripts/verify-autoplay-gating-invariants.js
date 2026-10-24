#!/usr/bin/env node

// Domain: Autoplay routing + autoplay genre filtering
// Guards two load-bearing playback behaviors:
//
//   1. "Autoplay off" must skip the *route queue* but MUST STILL allow random
//      fallback — the random fallback is what the manual "next" button uses, so
//      it must not be gated on autoplayEnabled (commit acbb3a7 "Fix next button:
//      random-fallback no longer gated on autoplayEnabled"). The route queue is
//      the only autoplay-gated state. A prior "cleanup" re-added the gate to
//      random-fallback and broke the next button.
//
//   2. Autoplay genre filters must match the *most specific* bucket, not every
//      bucket a genre overlaps. When the "Rock / Metal" catch-all bucket was
//      introduced, resolveAllTopLevelGenreBuckets made every rock/metal genre
//      share that bucket, so a "doom" filter started matching thrash, death,
//      black metal, etc. Fixed in apps/web/lib/player-preferences-shared.ts.
//
// This invariant asserts the source still contains the correct guards AND that
// the corresponding vitest suites still assert the behavior, so neither the
// behavior nor its test can be silently changed back.

const path = require("node:path");
const {
  readFileStrict,
  mapRelativeFiles,
  assertFilesExist,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = mapRelativeFiles(ROOT, {
  nextTrackTarget: "apps/web/domains/player/resolve-next-track-target.ts",
  nextTrackTargetTest: "apps/web/domains/player/resolve-next-track-target.test.ts",
  preferencesShared: "apps/web/lib/player-preferences-shared.ts",
  preferencesSharedTest: "apps/web/lib/player-preferences-shared.test.ts",
});

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function main() {
  const failures = [];

  assertFilesExist(
    {
      nextTrackTarget: files.nextTrackTarget,
      nextTrackTargetTest: files.nextTrackTargetTest,
      preferencesShared: files.preferencesShared,
      preferencesSharedTest: files.preferencesSharedTest,
    },
    failures,
    ROOT,
  );

  const nextTrackSource = readFileStrict(files.nextTrackTarget, ROOT);
  const nextTrackTest = readFileStrict(files.nextTrackTargetTest, ROOT);
  const preferencesSource = readFileStrict(files.preferencesShared, ROOT);
  const preferencesTest = readFileStrict(files.preferencesSharedTest, ROOT);

  // ── 1. Only the route queue may be gated on autoplayEnabled ────────────
  const autoplayGate = "if (!options.autoplayEnabled)";
  const gateCount = countOccurrences(nextTrackSource, autoplayGate);

  assertContains(
    nextTrackSource,
    'state: "route-queue"',
    "resolveNextTrackTarget defines a route-queue state",
    failures,
  );
  assertContains(
    nextTrackSource,
    'state: "random-fallback"',
    "resolveNextTrackTarget defines a random-fallback state",
    failures,
  );

  if (gateCount !== 1) {
    failures.push(
      `autoplayEnabled must gate exactly the route-queue state, found ${gateCount} gate(s) (random-fallback must stay ungated for the manual next button)`,
    );
  }

  assertContains(
    nextTrackSource,
    "const target = resolveRandomFallbackTarget(options.getRandomWatchNextId);",
    "random-fallback resolves via resolveRandomFallbackTarget",
    failures,
  );

  assertContains(
    nextTrackTest,
    "falls back to random even when autoplay is off (manual next button)",
    "resolveNextTrackTarget test asserts manual-next random fallback with autoplay off",
    failures,
  );
  assertContains(
    nextTrackTest,
    "skips the route queue and falls back to random when autoplay is off",
    "resolveNextTrackTarget test asserts route-queue is skipped with autoplay off",
    failures,
  );

  // ── 2. Genre filters must use the most-specific bucket ─────────────────
  assertContains(
    preferencesSource,
    "doesVideoMatchAutoplayGenres",
    "player-preferences-shared defines doesVideoMatchAutoplayGenres",
    failures,
  );
  assertContains(
    preferencesSource,
    "const videoBucket = resolveTopLevelGenreBucket(normalizedGenre)",
    "genre matching resolves the video's most-specific bucket",
    failures,
  );
  assertNotContains(
    preferencesSource,
    "resolveAllTopLevelGenreBuckets",
    "genre matching must not use the all-buckets resolver (catch-all over-match regression)",
    failures,
  );
  assertContains(
    preferencesTest,
    "does not over-match other subgenres that share the Rock / Metal catch-all bucket",
    "doesVideoMatchAutoplayGenres test asserts catch-all over-match regression",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Autoplay gating invariants failed:",
    successMessage: "Autoplay gating invariants passed.",
  });
}

main();
