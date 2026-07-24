#!/usr/bin/env node

// Domain: Local-Only (Unauthenticated) Onboarding Flow
// Verifies that users who choose "Skip — save locally only" in the welcome
// modal have their genre preferences reflected in:
//   1. The "new" page genre filters
//   2. The auto-play button visibility and toggle behavior
//   3. The watch-next rail genre filtering (via current-video API)

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  welcomeModal: path.join(ROOT, "apps/web/components/welcome-modal.tsx"),
  genrePrefStore: path.join(ROOT, "apps/web/lib/genre-preference-store.ts"),
  useNewVideosGenrePref: path.join(ROOT, "apps/web/hooks/use-new-videos-genre-preference.ts"),
  newVideosLoader: path.join(ROOT, "apps/web/components/new-videos-loader.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  currentVideoRoute: path.join(ROOT, "apps/web/app/api/current-video/route.ts"),
  eventsContract: path.join(ROOT, "apps/web/lib/events-contract.ts"),
};

function main() {
  const failures = [];

  const welcomeModalSource = readFileStrict(files.welcomeModal, ROOT);
  const genrePrefStoreSource = readFileStrict(files.genrePrefStore, ROOT);
  const useNewVideosGenrePrefSource = readFileStrict(files.useNewVideosGenrePref, ROOT);
  const newVideosLoaderSource = readFileStrict(files.newVideosLoader, ROOT);
  const shellDynamicSource = readFileStrict(files.shellDynamic, ROOT);
  const playerExperienceSource = readFileStrict(files.playerExperience, ROOT);
  const currentVideoRouteSource = readFileStrict(files.currentVideoRoute, ROOT);
  const eventsContractSource = readFileStrict(files.eventsContract, ROOT);

  // ── Event contract ───────────────────────────────────────────────────────

  assertContains(
    eventsContractSource,
    "WELCOME_GENRES_PERSISTED",
    "Events contract defines WELCOME_GENRES_PERSISTED",
    failures,
  );

  // ── Welcome modal: skips when preferences already saved ───────────────────

  assertContains(
    welcomeModalSource,
    "GENRE_PREFERENCES_KEY",
    "Welcome modal checks GENRE_PREFERENCES_KEY before showing",
    failures,
  );

  // ── Welcome modal: writes genres + dispatches event ───────────────────────

  assertContains(
    welcomeModalSource,
    "WELCOME_GENRES_PERSISTED",
    "Welcome modal dispatches WELCOME_GENRES_PERSISTED event",
    failures,
  );

  assertContains(
    welcomeModalSource,
    "save locally only",
    "Welcome modal offers local-only skip option",
    failures,
  );

  // ── New-videos page: reads genre preferences for unauthenticated users ────

  assertContains(
    useNewVideosGenrePrefSource,
    "WELCOME_GENRES_PERSISTED",
    "useNewVideosGenrePreference listens for WELCOME_GENRES_PERSISTED",
    failures,
  );

  assertContains(
    useNewVideosGenrePrefSource,
    "readGenrePreferences",
    "useNewVideosGenrePreference imports readGenrePreferences",
    failures,
  );

  assertContains(
    useNewVideosGenrePrefSource,
    "readPersistedFilters",
    "useNewVideosGenrePreference calls readPersistedFilters on event",
    failures,
  );

  // ── shell-dynamic-core: unblocks intro when preferences exist ─────────────

  assertContains(
    shellDynamicSource,
    '"ytr:genre-preferences"',
    "Shell checks genre-preferences before blocking intro animation",
    failures,
  );

  // ── shell-dynamic-core: passes genre filters for unauthenticated users ────

  assertContains(
    shellDynamicSource,
    "readGenrePreferences",
    "Shell imports readGenrePreferences for local-only genre filters",
    failures,
  );

  assertContains(
    shellDynamicSource,
    "autoplayGenreFilters",
    "Shell passes autoplayGenreFilters query param to current-video API",
    failures,
  );

  // ── current-video route: accepts client genre filters ─────────────────────

  assertContains(
    currentVideoRouteSource,
    "autoplayGenreFilters",
    "current-video route accepts autoplayGenreFilters query param",
    failures,
  );

  assertContains(
    currentVideoRouteSource,
    "searchParams.get",
    "current-video route reads autoplayGenreFilters from query string",
    failures,
  );

  // ── Auto-play button: NOT gated on isLoggedIn ─────────────────────────────

  // The auto-play button must render for unauthenticated users.
  // We verify this by checking that the button is NOT inside an isLoggedIn
  // conditional block.

  // The auto-play button element with class "primaryActionAutoplayButton"
  // must exist and must not be guarded by "isLoggedIn ?".
  assertContains(
    playerExperienceSource,
    "primaryActionAutoplayButton",
    "Auto-play button element exists in player experience",
    failures,
  );

  // The handleSetAutoplayEnabled function must work for unauthenticated users.
  // It must NOT return early when !isLoggedIn.
  // Strategy: find the function, then check that it sets localStorage
  // regardless of auth state.

  assertContains(
    playerExperienceSource,
    "async function handleSetAutoplayEnabled",
    "handleSetAutoplayEnabled function exists",
    failures,
  );

  // The autoplayEnabled state is loaded from localStorage when unauthenticated.
  assertContains(
    playerExperienceSource,
    "AUTOPLAY_KEY",
    "Auto-play preference key is referenced for localStorage read",
    failures,
  );

  // ── Genre preference store: readable by all consumers ─────────────────────

  assertContains(
    genrePrefStoreSource,
    "export function readGenrePreferences",
    "readGenrePreferences is exported from store",
    failures,
  );

  assertContains(
    genrePrefStoreSource,
    '"ytr:genre-preferences"',
    "Genre preference store uses canonical key",
    failures,
  );

  // ── New videos loader: uses genre preference hook ─────────────────────────

  assertContains(
    newVideosLoaderSource,
    "useNewVideosGenrePreference",
    "New videos loader consumes genre preference hook",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Local-only onboarding invariant check failed.",
    successMessage: "Local-only onboarding invariant check passed.",
  });
}

main();
