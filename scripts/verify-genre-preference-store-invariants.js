#!/usr/bin/env node

// Domain: Genre Preference Store
// Verifies the contract between the genre-preference-store, the welcome modal
// (which writes preferences), and consumers (new-videos page filter,
// autoplay/watch-next rail).

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  store: path.join(ROOT, "apps/web/lib/genre-preference-store.ts"),
  welcomeModal: path.join(ROOT, "apps/web/components/welcome-modal.tsx"),
  useNewVideosGenrePref: path.join(ROOT, "apps/web/hooks/use-new-videos-genre-preference.ts"),
  newVideosLoader: path.join(ROOT, "apps/web/components/new-videos-loader.tsx"),
};

function main() {
  const failures = [];

  const storeSource = readFileStrict(files.store, ROOT);
  const welcomeModalSource = readFileStrict(files.welcomeModal, ROOT);
  const useNewVideosGenrePrefSource = readFileStrict(files.useNewVideosGenrePref, ROOT);
  const newVideosLoaderSource = readFileStrict(files.newVideosLoader, ROOT);

  // ── Store API ────────────────────────────────────────────────────────────

  assertContains(storeSource, '"ytr:genre-preferences"', "Store uses the canonical localStorage key", failures);
  assertContains(storeSource, "export function readGenrePreferences", "readGenrePreferences is exported", failures);
  assertContains(storeSource, "export function writeGenrePreferences", "writeGenrePreferences is exported", failures);
  assertContains(storeSource, "export function clearGenrePreferences", "clearGenrePreferences is exported", failures);
  assertContains(storeSource, "export function hasGenrePreferences", "hasGenrePreferences is exported", failures);

  // readGenrePreferences returns null for empty/invalid state
  assertContains(storeSource, "return null", "readGenrePreferences returns null for empty or invalid state", failures);

  // readGenrePreferences normalizes entries to trimmed strings
  assertContains(storeSource, "entry.trim()", "readGenrePreferences trims entries before returning", failures);

  // writeGenrePreferences uses JSON.stringify
  assertContains(storeSource, "JSON.stringify(genres)", "writeGenrePreferences serializes as JSON", failures);

  // clearGenrePreferences removes the key
  assertContains(storeSource, 'localStorage.removeItem', "clearGenrePreferences removes the localStorage key", failures);

  // All functions guard against SSR (typeof window === "undefined")
  assertContains(storeSource, 'typeof window === "undefined"', "Store guards against SSR environment", failures);

  // ── Welcome modal: writer ────────────────────────────────────────────────

  assertContains(welcomeModalSource, "GENRE_PREFERENCES_KEY", "Welcome modal references genre preferences key", failures);
  assertContains(welcomeModalSource, "persistGenres", "Welcome modal defines persistGenres", failures);
  assertContains(welcomeModalSource, "localStorage.setItem", "Welcome modal writes genre preferences to localStorage", failures);
  assertContains(welcomeModalSource, "JSON.stringify", "Welcome modal serializes genre selections as JSON", failures);

  // persistGenres is called before Phase 2 transition
  assertContains(welcomeModalSource, "persistGenres();", "Welcome modal persists genres before account prompt", failures);

  // ── use-new-videos-genre-preference: primary consumer ──────────────────────

  assertContains(useNewVideosGenrePrefSource, "readGenrePreferences", "useNewVideosGenrePreference imports readGenrePreferences", failures);
  assertContains(useNewVideosGenrePrefSource, '"@/lib/genre-preference-store"', "useNewVideosGenrePreference imports from genre-preference-store", failures);

  // ── new-videos-loader: consumer via hook ──────────────────────────────────

  assertContains(newVideosLoaderSource, "useNewVideosGenrePreference", "new-videos-loader uses genre preference hook", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Genre preference store invariant check failed.",
    successMessage: "Genre preference store invariant check passed.",
  });
}

main();
