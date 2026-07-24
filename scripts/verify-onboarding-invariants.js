#!/usr/bin/env node

// Domain: Onboarding
// Covers: welcome modal (genre selection + account prompt), AnonymousSignupModal,
// genre preference store persistence, and shell-dynamic-core wiring for the
// standalone anonymous signup path.

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
  anonymousSignupModal: path.join(ROOT, "apps/web/components/anonymous-signup-modal.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  genrePreferenceStore: path.join(ROOT, "apps/web/lib/genre-preference-store.ts"),
  useNewVideosGenrePref: path.join(ROOT, "apps/web/hooks/use-new-videos-genre-preference.ts"),
  anonymousCredentialsModal: path.join(ROOT, "apps/web/components/anonymous-credentials-modal.tsx"),
  authLoginForm: path.join(ROOT, "apps/web/components/auth-login-form.tsx"),
  globalCss: path.join(ROOT, "apps/web/app/globals.css"),
  authModalCss: path.join(ROOT, "apps/web/app/styles/auth-modal.css"),
};

function collectCssFiles(dirPath) {
  const fs = require("node:fs");
  const results = [];
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectCssFiles(full));
      } else if (entry.name.endsWith(".css")) {
        results.push(full);
      }
    }
  } catch { /* ignore missing dirs */ }
  return results;
}

function main() {
  const failures = [];

  const welcomeModalSource = readFileStrict(files.welcomeModal, ROOT);
  const anonymousSignupModalSource = readFileStrict(files.anonymousSignupModal, ROOT);
  const shellDynamicSource = [
    readFileStrict(files.shellDynamic, ROOT),
    readFileStrict(path.join(ROOT, "apps/web/components/shell-dynamic-rendering.tsx"), ROOT),
  ].join("\n");
  const genrePreferenceStoreSource = readFileStrict(files.genrePreferenceStore, ROOT);
  const useNewVideosGenrePrefSource = readFileStrict(files.useNewVideosGenrePref, ROOT);
  const anonymousCredentialsModalSource = readFileStrict(files.anonymousCredentialsModal, ROOT);
  const authLoginFormSource = readFileStrict(files.authLoginForm, ROOT);

  // Combine all CSS sources
  const cssDirs = [
    path.join(ROOT, "apps/web/app/styles"),
  ];
  const globalCssSource = [
    readFileStrict(files.globalCss, ROOT),
    ...cssDirs.flatMap((d) => collectCssFiles(d).map((f) => readFileStrict(f, ROOT))),
  ].join("\n");

  // =========================================================================
  // Welcome modal — structural checks
  // =========================================================================

  assertContains(welcomeModalSource, "export function WelcomeModal(", "WelcomeModal is exported", failures);
  assertContains(welcomeModalSource, "onOpenAuthModal?: () => void", "WelcomeModal accepts onOpenAuthModal callback prop", failures);
  assertContains(welcomeModalSource, "showAccountPrompt", "WelcomeModal tracks Phase 2 via showAccountPrompt state", failures);
  assertContains(welcomeModalSource, "WELCOME_DISMISSED_KEY", "WelcomeModal uses WELCOME_DISMISSED_KEY for permanent dismissal", failures);
  assertContains(welcomeModalSource, 'welcomeModal', "WelcomeModal renders with welcomeModal class", failures);
  assertContains(welcomeModalSource, 'role="dialog"', "WelcomeModal renders as a dialog", failures);
  assertContains(welcomeModalSource, 'aria-modal="true"', "WelcomeModal declares aria-modal", failures);
  assertContains(welcomeModalSource, "welcomeModalBackdrop", "WelcomeModal renders a backdrop", failures);
  assertContains(welcomeModalSource, "welcomeModalPanel", "WelcomeModal renders a panel", failures);
  assertContains(welcomeModalSource, "welcomeModalGrid", "WelcomeModal Phase 1 renders genre grid", failures);
  assertContains(welcomeModalSource, "welcomeModalCard", "WelcomeModal Phase 1 renders genre cards", failures);
  assertContains(welcomeModalSource, "welcomeModalAccountOptions", "WelcomeModal Phase 2 renders account options", failures);
  assertContains(welcomeModalSource, "welcomeModalAccountButton--primary", "WelcomeModal Phase 2 has a primary account button (anonymous)", failures);
  assertContains(welcomeModalSource, "welcomeModalAccountButton--secondary", "WelcomeModal Phase 2 has a secondary account button (email)", failures);
  assertContains(welcomeModalSource, "welcomeModalAccountButton--ghost", "WelcomeModal Phase 2 has a ghost account button (skip)", failures);

  // Phase 2 button behaviors
  assertContains(welcomeModalSource, "handleCreateAnonymous", "WelcomeModal has handleCreateAnonymous handler", failures);
  assertContains(welcomeModalSource, "handleRegister", "WelcomeModal has handleRegister handler", failures);
  assertContains(welcomeModalSource, "handleSkip", "WelcomeModal has handleSkip handler", failures);
  assertContains(welcomeModalSource, "onOpenAuthModal?.()", "handleCreateAnonymous calls onOpenAuthModal callback", failures);
  assertContains(welcomeModalSource, '"/register"', "handleRegister navigates to /register", failures);

  // Genre persistence
  assertContains(welcomeModalSource, "persistGenres", "WelcomeModal has persistGenres function", failures);
  assertContains(welcomeModalSource, "GENRE_PREFERENCES_KEY", "WelcomeModal uses GENRE_PREFERENCES_KEY for genre persistence", failures);
  assertContains(welcomeModalSource, '"/api/categories/top-level-cards"', "WelcomeModal fetches top-level category cards", failures);

  // Permanent dismissal
  assertContains(welcomeModalSource, "dontShowAgain", "WelcomeModal tracks dontShowAgain checkbox", failures);

  // Body scroll locking
  assertContains(welcomeModalSource, 'body.style.overflow = "hidden"', "WelcomeModal locks body scroll when open", failures);

  // Escape key dismiss
  assertContains(welcomeModalSource, 'event.key === "Escape"', "WelcomeModal dismisses on Escape key", failures);

  // =========================================================================
  // AnonymousSignupModal — structural checks
  // =========================================================================

  assertContains(anonymousSignupModalSource, "export function AnonymousSignupModal(", "AnonymousSignupModal is exported", failures);
  assertContains(anonymousSignupModalSource, "isOpen", "AnonymousSignupModal accepts isOpen prop", failures);
  assertContains(anonymousSignupModalSource, "onClose", "AnonymousSignupModal accepts onClose prop", failures);
  assertContains(anonymousSignupModalSource, "anonymousSignupOverlay", "AnonymousSignupModal renders with overlay CSS class", failures);
  assertContains(anonymousSignupModalSource, 'role="dialog"', "AnonymousSignupModal renders as a dialog", failures);
  assertContains(anonymousSignupModalSource, 'aria-modal="true"', "AnonymousSignupModal declares aria-modal", failures);

  // Screen-name form
  assertContains(anonymousSignupModalSource, "Choose your screen name", "AnonymousSignupModal prompts for screen name", failures);
  assertContains(anonymousSignupModalSource, 'name="anonymousScreenName"', "AnonymousSignupModal renders screen-name input", failures);
  assertContains(anonymousSignupModalSource, "handleCreate", "AnonymousSignupModal has account creation handler", failures);
  assertContains(anonymousSignupModalSource, '"/api/auth/anonymous"', "AnonymousSignupModal calls POST /api/auth/anonymous", failures);
  assertContains(anonymousSignupModalSource, "availability", "AnonymousSignupModal tracks screen-name availability", failures);

  // Screen-name suggestion
  assertContains(anonymousSignupModalSource, "assignAvailableSuggestion", "AnonymousSignupModal fetches suggested screen name", failures);

  // Credentials modal
  assertContains(anonymousSignupModalSource, "AnonymousCredentialsModal", "AnonymousSignupModal renders credentials after account creation", failures);
  assertContains(anonymousSignupModalSource, "handleCredentialsContinue", "AnonymousSignupModal has continue-after-credentials handler", failures);

  // Auth on success
  assertContains(anonymousSignupModalSource, "AUTH_SUCCESS", "AnonymousSignupModal dispatches AUTH_SUCCESS event", failures);
  assertContains(anonymousSignupModalSource, 'publishAuthStateChange("authenticated")', "AnonymousSignupModal broadcasts auth state change", failures);
  assertContains(anonymousSignupModalSource, "ANONYMOUS_USERNAME_KEY", "AnonymousSignupModal stores anonymous username in localStorage", failures);

  // Body scroll locking
  assertContains(anonymousSignupModalSource, 'body.style.overflow = "hidden"', "AnonymousSignupModal locks body scroll when open", failures);

  // Escape key dismiss
  assertContains(anonymousSignupModalSource, 'event.key === "Escape"', "AnonymousSignupModal dismisses on Escape key", failures);

  // =========================================================================
  // Genre preference store — contract checks
  // =========================================================================

  assertContains(genrePreferenceStoreSource, "GENRE_PREFERENCES_KEY", "Genre preference store defines the storage key", failures);
  assertContains(genrePreferenceStoreSource, '"ytr:genre-preferences"', "Genre preference store key matches expected value", failures);
  assertContains(genrePreferenceStoreSource, "export function readGenrePreferences", "Genre preference store exports readGenrePreferences", failures);
  assertContains(genrePreferenceStoreSource, "export function writeGenrePreferences", "Genre preference store exports writeGenrePreferences", failures);
  assertContains(genrePreferenceStoreSource, "export function clearGenrePreferences", "Genre preference store exports clearGenrePreferences", failures);
  assertContains(genrePreferenceStoreSource, "export function hasGenrePreferences", "Genre preference store exports hasGenrePreferences", failures);
  assertContains(genrePreferenceStoreSource, "localStorage", "Genre preference store uses localStorage for persistence", failures);

  // Consumer: use-new-videos-genre-preference hook
  assertContains(useNewVideosGenrePrefSource, "readGenrePreferences", "useNewVideosGenrePreference imports readGenrePreferences", failures);
  assertContains(useNewVideosGenrePrefSource, "from \"@/lib/genre-preference-store\"", "useNewVideosGenrePreference imports from genre-preference-store", failures);

  // =========================================================================
  // Shell: standalone anonymous signup wiring
  // =========================================================================

  assertContains(shellDynamicSource, "const [isAnonymousSignupOpen, setIsAnonymousSignupOpen] = useState(false);", "Shell tracks anonymous signup modal state", failures);
  assertContains(shellDynamicSource, "import { AnonymousSignupModal }", "Shell imports AnonymousSignupModal", failures);
  assertContains(shellDynamicSource, "<AnonymousSignupModal", "Shell renders AnonymousSignupModal", failures);
  assertContains(shellDynamicSource, "isOpen={isAnonymousSignupOpen}", "Shell passes isOpen to AnonymousSignupModal", failures);
  assertContains(shellDynamicSource, "openAuthModalAnonymous", "Shell defines openAuthModalAnonymous function", failures);
  assertContains(shellDynamicSource, "setIsAnonymousSignupOpen(true)", "openAuthModalAnonymous opens the standalone signup modal", failures);
  assertContains(shellDynamicSource, "setIsAnonymousSignupOpen(false)", "Shell closes anonymous signup modal on auth success", failures);

  // WelcomeModal rendering in shell
  assertContains(shellDynamicSource, "<WelcomeModal", "Shell renders WelcomeModal component", failures);
  assertContains(shellDynamicSource, "onOpenAuthModal={openAuthModalAnonymous}", "Shell passes openAuthModalAnonymous as WelcomeModal onOpenAuthModal", failures);

  // auth-login-form retains its inline anonymous flow
  assertContains(authLoginFormSource, "isAnonymousFlowOpen", "AuthLoginForm retains isAnonymousFlowOpen state for inline anonymous flow", failures);
  assertContains(authLoginFormSource, "handleAnonymousEntry", "AuthLoginForm retains handleAnonymousEntry for inline anonymous flow", failures);

  // =========================================================================
  // CSS: onboarding-specific classes
  // =========================================================================

  assertContains(globalCssSource, ".anonymousSignupOverlay", "CSS defines .anonymousSignupOverlay for standalone signup", failures);
  assertContains(globalCssSource, "z-index: 3000", "anonymousSignupOverlay uses z-index 3000 above auth modal", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Onboarding invariant check failed.",
    successMessage: "Onboarding invariant check passed.",
  });
}

main();
