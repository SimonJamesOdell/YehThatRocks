#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  accountPage: path.join(ROOT, "apps/web/app/(shell)/account/page.tsx"),
  accountPanel: path.join(ROOT, "apps/web/components/account-settings-panel.tsx"),
  logoutButton: path.join(ROOT, "apps/web/components/auth-logout-button.tsx"),
  loginForm: path.join(ROOT, "apps/web/components/auth-login-form.tsx"),
  anonymousCredentialsModal: path.join(ROOT, "apps/web/components/anonymous-credentials-modal.tsx"),
  changePasswordForm: path.join(ROOT, "apps/web/components/auth-change-password-form.tsx"),
  forgotPasswordForm: path.join(ROOT, "apps/web/components/auth-forgot-password-form.tsx"),
  accountActions: path.join(ROOT, "apps/web/components/auth-account-actions.tsx"),
  authRetryButton: path.join(ROOT, "apps/web/components/auth-status-retry-button.tsx"),
  protectedAuthGatePanel: path.join(ROOT, "apps/web/components/protected-auth-gate-panel.tsx"),
  anonymousRoute: path.join(ROOT, "apps/web/app/api/auth/anonymous/route.ts"),
  loginRoute: path.join(ROOT, "apps/web/app/api/auth/login/route.ts"),
  logoutRoute: path.join(ROOT, "apps/web/app/api/auth/logout/route.ts"),
  profileRoute: path.join(ROOT, "apps/web/app/api/auth/profile/route.ts"),
  changePasswordRoute: path.join(ROOT, "apps/web/app/api/auth/change-password/route.ts"),
  forgotPasswordRoute: path.join(ROOT, "apps/web/app/api/auth/forgot-password/route.ts"),
  sendVerificationRoute: path.join(ROOT, "apps/web/app/api/auth/send-verification/route.ts"),
  shellLayout: path.join(ROOT, "apps/web/app/(shell)/layout.tsx"),
  shellDynamic: path.join(ROOT, "apps/web/components/shell-dynamic-core.tsx"),
  historyPage: path.join(ROOT, "apps/web/app/(shell)/history/page.tsx"),
  favouritesPage: path.join(ROOT, "apps/web/app/(shell)/favourites/page.tsx"),
  playlistsPage: path.join(ROOT, "apps/web/app/(shell)/playlists/page.tsx"),
  playlistDetailPage: path.join(ROOT, "apps/web/app/(shell)/playlists/[id]/page.tsx"),
  adminPage: path.join(ROOT, "apps/web/app/(shell)/admin/page.tsx"),
  adminAuth: path.join(ROOT, "apps/web/lib/admin-auth.ts"),
  authRequest: path.join(ROOT, "apps/web/lib/auth-request.ts"),
  serverAuth: path.join(ROOT, "apps/web/lib/server-auth.ts"),
  authCookies: path.join(ROOT, "apps/web/lib/auth-cookies.ts"),
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

function assertContainsEither(source, needles, description, failures) {
  if (!needles.some(needle => source.includes(needle))) {
    failures.push(`${description} (missing any of: ${needles.join(", ")})`);
  }
}

function assertNotContains(source, needle, description, failures) {
  if (source.includes(needle)) {
    failures.push(`${description} (unexpected: ${needle})`);
  }
}

function main() {
  const failures = [];

  const accountPageSource = read(files.accountPage);
  const accountPanelSource = read(files.accountPanel);
  const logoutButtonSource = read(files.logoutButton);
  const loginFormSource = read(files.loginForm);
  const anonymousCredentialsModalSource = read(files.anonymousCredentialsModal);
  const changePasswordFormSource = read(files.changePasswordForm);
  const forgotPasswordFormSource = read(files.forgotPasswordForm);
  const accountActionsSource = read(files.accountActions);
  const authRetryButtonSource = read(files.authRetryButton);
  const protectedAuthGatePanelSource = read(files.protectedAuthGatePanel);
  const anonymousRouteSource = read(files.anonymousRoute);
  const profileRouteSource = read(files.profileRoute);
  const shellLayoutSource = read(files.shellLayout);
  const shellDynamicSource = read(files.shellDynamic);
  const historyPageSource = read(files.historyPage);
  const favouritesPageSource = read(files.favouritesPage);
  const playlistsPageSource = read(files.playlistsPage);
  const playlistDetailPageSource = read(files.playlistDetailPage);
  const adminPageSource = read(files.adminPage);
  const adminAuthSource = read(files.adminAuth);
  const authRequestSource = read(files.authRequest);
  const serverAuthSource = read(files.serverAuth);
  const authCookiesSource = read(files.authCookies);
  const globalCssSource = read(files.globalCss);

  // --- Account page tabs and top-bar actions ---
  assertContains(accountPageSource, "<AuthLogoutButton />", "Account page renders logout action in the top bar", failures);
  assertContains(accountPageSource, "className=\"accountTopBarActions\"", "Account page groups top-right actions", failures);
  assertContains(accountPageSource, "<AccountSettingsPanel", "Account page renders tabbed account settings panel", failures);
  assertContains(accountPageSource, "<ProtectedAuthGatePanel", "Account page uses shared protected auth panel for non-authenticated states", failures);
  assertContains(accountPanelSource, "User details", "Account panel has User details tab", failures);
  assertContains(accountPanelSource, "Security", "Account panel has Security tab", failures);
  assertContains(accountPanelSource, "name=\"avatarUrl\"", "Account panel includes avatar URL field", failures);
  assertContains(accountPanelSource, "name=\"bio\"", "Account panel includes bio field", failures);
  assertContains(accountPanelSource, "name=\"location\"", "Account panel includes location field", failures);
  assertContains(accountPanelSource, '"/api/auth/profile"', "Account panel saves profile details via /api/auth/profile", failures);
  assertContains(accountPanelSource, "showLogout={false}", "Security tab hides duplicate logout button", failures);
  assertContains(logoutButtonSource, '"/api/auth/logout"', "Top-bar logout button posts to /api/auth/logout", failures);
  assertContains(authRetryButtonSource, "router.refresh()", "Auth retry button refreshes the route", failures);
  assertContains(protectedAuthGatePanelSource, "Auth check unavailable", "Protected auth panel has dedicated auth-unavailable messaging", failures);
  assertContains(protectedAuthGatePanelSource, "Retry auth now", "Protected auth panel exposes retry action", failures);

  // --- Protected route consistency ---
  assertContains(historyPageSource, "getCurrentAuthenticatedUserAuthState", "History page uses explicit auth state resolution", failures);
  assertContains(historyPageSource, "<ProtectedAuthGatePanel", "History page uses shared protected auth panel", failures);
  assertContains(favouritesPageSource, "getCurrentAuthenticatedUserAuthState", "Favourites page uses explicit auth state resolution", failures);
  assertContains(favouritesPageSource, "<ProtectedAuthGatePanel", "Favourites page uses shared protected auth panel", failures);
  assertContains(playlistsPageSource, "getCurrentAuthenticatedUserAuthState", "Playlists page uses explicit auth state resolution", failures);
  assertContains(playlistsPageSource, "<ProtectedAuthGatePanel", "Playlists page uses shared protected auth panel", failures);
  assertContains(playlistDetailPageSource, "getCurrentAuthenticatedUserAuthState", "Playlist detail page uses explicit auth state resolution", failures);
  assertContains(playlistDetailPageSource, "<ProtectedAuthGatePanel", "Playlist detail page uses shared protected auth panel", failures);
  assertContains(adminAuthSource, "requireAdminUserAuthState", "Admin auth helper exposes unavailable/unauthenticated/forbidden states", failures);
  assertContains(adminPageSource, "requireAdminUserAuthState", "Admin page uses explicit admin auth state", failures);
  assertContains(adminPageSource, "adminAuthState.status === \"unavailable\"", "Admin page distinguishes auth-unavailable state", failures);

  // --- Profile API route ---
  assertContains(profileRouteSource, "export async function PATCH", "Profile API supports PATCH updates", failures);
  assertContains(profileRouteSource, "verifySameOrigin(request)", "Profile API enforces same-origin CSRF protection", failures);
  assertContains(profileRouteSource, "screenName", "Profile API validates screenName", failures);
  assertContains(profileRouteSource, "avatarUrl", "Profile API validates avatarUrl", failures);
  assertContains(profileRouteSource, "bio", "Profile API handles bio", failures);
  assertContains(profileRouteSource, "location", "Profile API handles location", failures);
  assertContains(profileRouteSource, "(prisma as PrismaWithProfileUser).user.update({", "Profile API persists profile fields through Prisma update", failures);

  // --- Login form ---
  assertContains(loginFormSource, 'name="email"', "Login form has email/handle input field", failures);
  // Login accepts email OR handle so the input intentionally uses type="text", not type="email"
  assertContains(loginFormSource, 'type="text"', "Login form identifier input uses type=text (accepts email or handle)", failures);
  assertContains(loginFormSource, 'name="password"', "Login form has password input field", failures);
  const loginPasswordHasStaticType = loginFormSource.includes('type="password"');
  const loginPasswordHasToggleType = loginFormSource.includes('type={isPasswordVisible ? "text" : "password"}');
  if (!loginPasswordHasStaticType && !loginPasswordHasToggleType) {
    failures.push("Login form password input uses password type or password visibility toggle");
  }
  assertContains(loginFormSource, 'autoComplete="username"', "Login form email input has correct autocomplete", failures);
  assertContains(loginFormSource, 'autoComplete="current-password"', "Login form password input has correct autocomplete", failures);
  assertContains(loginFormSource, 'className="authForm"', "Login form uses authForm CSS class", failures);
  assertContains(loginFormSource, 'className="authMessage"', "Login form renders errors with authMessage class", failures);
  assertContainsEither(loginFormSource, ["disabled={isSubmitting}", "disabled={isBusy}"], "Login form disables submit button while auth actions are pending", failures);
  assertContains(loginFormSource, '"/api/auth/login"', "Login form posts to /api/auth/login", failures);
  assertContains(loginFormSource, 'const INTRO_SKIP_ONCE_AFTER_LOGIN_KEY = "ytr:intro-skip-once";', "Login form defines one-shot intro skip key for post-auth transition", failures);
  assertContains(loginFormSource, 'window.sessionStorage.setItem(INTRO_SKIP_ONCE_AFTER_LOGIN_KEY, "1");', "Login form sets one-shot intro skip marker on successful login", failures);
  assertContainsEither(loginFormSource, ['router.push(target)', 'window.location.href = target'], "Login form redirects on success via router.push or full page reload", failures);
  assertContains(loginFormSource, "`/?v=${encodeURIComponent(videoParam)}`", "Login redirects back to video param when present", failures);
  assertContains(loginFormSource, "isAnonymousFlowOpen && !anonymousCredentials", "Anonymous screen-name modal is hidden while credentials modal is open", failures);
  assertContains(loginFormSource, "setIsAnonymousFlowOpen(false);", "Anonymous screen-name modal closes after account creation", failures);
  assertContains(loginFormSource, "const [isAnonymousCredentialsContinuePending, setIsAnonymousCredentialsContinuePending] = useState(false);", "Login form tracks pending continue state for anonymous credentials modal", failures);
  assertContains(loginFormSource, "function canStoreBrowserCredential()", "Login form exposes browser credential store capability check", failures);
  assertContains(loginFormSource, "async function hasAuthenticatedSession()", "Login form verifies authenticated session before redirect from anonymous flow", failures);
  assertContains(loginFormSource, '"/api/auth/me"', "Login form checks /api/auth/me during anonymous continue flow", failures);
  assertContains(loginFormSource, "redirectOnSuccess: false", "Anonymous continue flow uses explicit login fallback without double redirect", failures);
  assertContains(loginFormSource, "onContinue={handleAnonymousCredentialsContinue}", "Anonymous credentials modal continue action is wired to auth finalization handler", failures);
  assertNotContains(loginFormSource, "ANONYMOUS_AUTO_LOGIN_TIMEOUT_MS", "Anonymous CTA does not race against saved-credential auto-login timeout", failures);
  assertNotContains(loginFormSource, "trySavedCredentialLogin(", "Anonymous CTA no longer uses saved browser credentials for immediate login", failures);
  assertContains(loginFormSource, "async function handleAnonymousEntry()", "Login form exposes anonymous-entry handler", failures);
  assertContains(loginFormSource, "await assignAvailableAnonymousSuggestion();", "Anonymous CTA always prepares anonymous screen name suggestions", failures);
  assertContains(loginFormSource, "setIsAnonymousFlowOpen(true);", "Anonymous CTA always opens anonymous account creation flow", failures);

  // --- Shared auth state handling ---
  assertContains(authRequestSource, 'code: "AUTH_UNAVAILABLE"', "API auth helper returns dedicated auth-unavailable code", failures);
  assertContains(authRequestSource, 'status: 503', "API auth helper uses 503 when auth verification is unavailable", failures);
  assertContains(serverAuthSource, 'status: "unavailable"', "Server auth helper exposes auth-unavailable status", failures);
  assertContains(serverAuthSource, 'status: "unauthenticated"', "Server auth helper exposes unauthenticated status", failures);
  assertContains(shellLayoutSource, 'initialAuthStatus={authState.status === "unavailable" ? "unavailable" : "clear"}', "Shell layout passes initial auth-unavailable state into the client shell", failures);
  assertContains(shellDynamicSource, 'const [authStatus, setAuthStatus] = useState<"clear" | "unavailable">(initialAuthStatus);', "Shell tracks auth availability separately from authenticated state", failures);
  assertContains(shellDynamicSource, 'response.status === 401 || response.status === 403', "Shell distinguishes confirmed auth failures from outages", failures);
  assertContains(shellDynamicSource, 'setIsAuthenticated(false);', "Shell drops global auth state on confirmed auth failure", failures);
  assertContains(shellDynamicSource, 'setAuthStatus("unavailable")', "Shell marks auth unavailable when probes cannot confirm session", failures);
  assertContains(shellDynamicSource, 'Retry auth now', "Shell exposes auth retry action during auth outages", failures);
  assertContains(shellDynamicSource, 'document.visibilityState !== "visible"', "Shell skips background auth polling while the tab is hidden", failures);
  assertContains(shellDynamicSource, 'window.addEventListener("online", onWindowOnline);', "Shell rechecks auth when connectivity returns", failures);

  // --- Auth cookie lifecycle ---
  assertContains(authCookiesSource, "export function clearAuthCookies(response: NextResponse)", "Auth cookies module exposes clearAuthCookies", failures);
  assertContains(authCookiesSource, "response.cookies.set(ACCESS_TOKEN_COOKIE, \"\", getAuthCookieOptions(0));", "Logout clears domain-scoped access cookie", failures);
  assertContains(authCookiesSource, "response.cookies.set(REFRESH_TOKEN_COOKIE, \"\", getAuthCookieOptions(0));", "Logout clears domain-scoped refresh cookie", failures);
  assertContains(authCookiesSource, "response.headers.append(\"Set-Cookie\", accessExpiry);", "Logout appends host-only access cookie expiry header", failures);
  assertContains(authCookiesSource, "response.headers.append(\"Set-Cookie\", refreshExpiry);", "Logout appends host-only refresh cookie expiry header", failures);
  assertContains(authCookiesSource, "ResponseCookies is keyed by name", "Auth cookie clear logic documents duplicate-name overwrite protection", failures);

  // --- Anonymous credentials modal ---
  assertContains(anonymousCredentialsModalSource, 'isContinuing ? "Continuing..." : "Continue"', "Anonymous credentials modal CTA is Continue with pending state", failures);
  assertContains(anonymousCredentialsModalSource, "credentialsSaveNotice", "Anonymous credentials modal includes credential save guidance notice", failures);
  assertContains(anonymousCredentialsModalSource, '"When you click Continue, your browser will try to save these credentials for you."', "Anonymous credentials modal informs users about browser save attempt", failures);
  assertContains(anonymousCredentialsModalSource, '"Your browser cannot save these credentials automatically here, so manual saving is required before you continue."', "Anonymous credentials modal informs users when manual save is required", failures);
  assertContains(anonymousCredentialsModalSource, "Save these credentials now.", "Anonymous credentials modal urges immediate manual credential saving", failures);
  assertContains(anonymousCredentialsModalSource, "max-width: 980px;", "Anonymous credentials modal uses expanded desktop width", failures);
  assertContains(anonymousCredentialsModalSource, "modalBodyGrid", "Anonymous credentials modal uses two-column body layout", failures);

  // --- Anonymous auth API route ---
  assertContains(anonymousRouteSource, "export async function POST", "Anonymous auth API route supports POST account creation", failures);
  assertContains(anonymousRouteSource, "rateLimitOrResponse(", "Anonymous auth API applies per-IP rate limits", failures);
  assertContains(anonymousRouteSource, "rateLimitSharedOrResponse(", "Anonymous auth API applies global shared rate limits", failures);
  assertContains(anonymousRouteSource, '"auth:anonymous:create"', "Anonymous auth API uses dedicated create abuse-control key", failures);
  assertContains(anonymousRouteSource, '"auth:anonymous:availability-check"', "Anonymous availability check endpoint uses dedicated abuse-control key", failures);
  assertContains(anonymousRouteSource, "Anonymous account create rate limited", "Anonymous auth API records audit logs for create rate-limit events", failures);
  assertContains(anonymousRouteSource, "setAuthCookies(response, accessToken, refreshToken, false);", "Anonymous auth API sets auth cookies on account creation", failures);
  assertContains(anonymousRouteSource, "credentials:", "Anonymous auth API response returns generated credentials", failures);
  assertContains(anonymousRouteSource, "const password = generateSecureCredential(16);", "Anonymous auth API generates secure password for new anonymous accounts", failures);

  // --- Change password form ---
  assertContains(changePasswordFormSource, 'name="currentPassword"', "Change password form has currentPassword field", failures);
  assertContains(changePasswordFormSource, 'name="newPassword"', "Change password form has newPassword field", failures);
  assertContains(changePasswordFormSource, 'name="confirmPassword"', "Change password form has confirmPassword field", failures);
  assertContains(changePasswordFormSource, "newPassword !== confirmPassword", "Change password form validates password confirmation match", failures);
  assertContains(changePasswordFormSource, '"/api/auth/change-password"', "Change password form posts to correct endpoint", failures);
  assertContains(changePasswordFormSource, 'className="authForm"', "Change password form uses authForm CSS class", failures);
  assertContains(changePasswordFormSource, 'className="authMessage"', "Change password form renders messages with authMessage class", failures);
  assertContains(changePasswordFormSource, "event.currentTarget.reset()", "Change password form resets after success", failures);

  // --- Forgot password form ---
  assertContains(forgotPasswordFormSource, 'name="email"', "Forgot password form has email field", failures);
  assertContains(forgotPasswordFormSource, 'type="email"', "Forgot password form email uses email type", failures);
  assertContains(forgotPasswordFormSource, '"/api/auth/forgot-password"', "Forgot password form posts to correct endpoint", failures);
  assertContains(forgotPasswordFormSource, 'className="authForm"', "Forgot password form uses authForm CSS class", failures);
  assertContains(forgotPasswordFormSource, 'className="authMessage"', "Forgot password form renders messages with authMessage class", failures);
  assertContains(forgotPasswordFormSource, "reset link has been sent", "Forgot password form shows safe confirmation message", failures);

  // --- Account actions (logout + send-verification) ---
  assertContains(accountActionsSource, '"/api/auth/logout"', "Account actions posts to /api/auth/logout", failures);
  assertContains(accountActionsSource, '"/api/auth/send-verification"', "Account actions posts to /api/auth/send-verification", failures);
  assertContains(accountActionsSource, "router.push(\"/\")", "Account actions redirects to home after logout", failures);
  assertContains(accountActionsSource, "router.refresh()", "Account actions refreshes router after logout", failures);
  assertContains(accountActionsSource, 'className="authMessage"', "Account actions renders messages with authMessage class", failures);
  assertContains(accountActionsSource, 'className="interactiveStack"', "Account actions uses interactiveStack layout", failures);
  assertContains(accountActionsSource, "emailVerified", "Account actions conditionally shows verification button", failures);

  // --- API route files exist ---
  for (const [key, filePath] of Object.entries(files)) {
    if (key === "globalCss") continue;
    if (!fs.existsSync(filePath)) {
      failures.push(`Auth API route file missing: ${path.relative(ROOT, filePath)}`);
    }
  }

  // --- CSS: authForm and authMessage must be styled ---
  assertContains(globalCssSource, ".authForm", "globals.css defines .authForm styles", failures);
  assertContains(globalCssSource, ".authMessage", "globals.css defines .authMessage styles", failures);
  assertContains(globalCssSource, ".interactiveStack", "globals.css defines .interactiveStack layout", failures);
  assertContains(globalCssSource, ".accountTabs", "globals.css defines account tab styles", failures);
  assertContains(globalCssSource, ".accountTopBarActions", "globals.css defines account top-bar action group", failures);
  assertContains(globalCssSource, ".accountAvatarPreviewWrap", "globals.css defines avatar preview styles", failures);
  assertContains(globalCssSource, ".authStatusBanner", "globals.css defines auth-unavailable banner styles", failures);

  if (failures.length > 0) {
    console.error("Auth invariant check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Auth invariant check passed.");
}

main();
