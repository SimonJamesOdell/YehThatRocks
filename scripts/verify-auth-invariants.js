#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const {
  readFileStrict,
  collectCssFiles,
  assertContains,
  assertContainsEither,
  assertNotContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

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
  resetPasswordRoute: path.join(ROOT, "apps/web/app/api/auth/reset-password/route.ts"),
  sendVerificationRoute: path.join(ROOT, "apps/web/app/api/auth/send-verification/route.ts"),
  verifyEmailRoute: path.join(ROOT, "apps/web/app/api/auth/verify-email/route.ts"),
  upgradeToEmailRoute: path.join(ROOT, "apps/web/app/api/auth/upgrade-to-email/route.ts"),
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
  authModal: path.join(ROOT, "apps/web/components/auth-modal.tsx"),
  playerExperience: path.join(ROOT, "apps/web/components/player-experience-core.tsx"),
  authCookies: path.join(ROOT, "apps/web/lib/auth-cookies.ts"),
  rateLimitLib: path.join(ROOT, "apps/web/lib/rate-limit.ts"),
  prismaTypes: path.join(ROOT, "apps/web/lib/prisma-types.ts"),
  authSessions: path.join(ROOT, "apps/web/lib/auth-sessions.ts"),
  authTokenRecords: path.join(ROOT, "apps/web/lib/auth-token-records.ts"),
  authAudit: path.join(ROOT, "apps/web/lib/auth-audit.ts"),
  appRoot: path.join(ROOT, "apps/web/app"),
};

function main() {
  const failures = [];

  const accountPageSource = readFileStrict(files.accountPage, ROOT);
  const accountPanelSource = readFileStrict(files.accountPanel, ROOT);
  const logoutButtonSource = readFileStrict(files.logoutButton, ROOT);
  const loginFormSource = readFileStrict(files.loginForm, ROOT);
  const anonymousCredentialsModalSource = readFileStrict(files.anonymousCredentialsModal, ROOT);
  const changePasswordFormSource = readFileStrict(files.changePasswordForm, ROOT);
  const forgotPasswordFormSource = readFileStrict(files.forgotPasswordForm, ROOT);
  const accountActionsSource = readFileStrict(files.accountActions, ROOT);
  const authRetryButtonSource = readFileStrict(files.authRetryButton, ROOT);
  const protectedAuthGatePanelSource = readFileStrict(files.protectedAuthGatePanel, ROOT);
  const anonymousRouteSource = readFileStrict(files.anonymousRoute, ROOT);
  const loginRouteSource = readFileStrict(files.loginRoute, ROOT);
  const profileRouteSource = readFileStrict(files.profileRoute, ROOT);
  const resetPasswordRouteSource = readFileStrict(files.resetPasswordRoute, ROOT);
  const sendVerificationRouteSource = readFileStrict(files.sendVerificationRoute, ROOT);
  const verifyEmailRouteSource = readFileStrict(files.verifyEmailRoute, ROOT);
  const upgradeToEmailRouteSource = readFileStrict(files.upgradeToEmailRoute, ROOT);
  const shellLayoutSource = readFileStrict(files.shellLayout, ROOT);
  const shellDynamicSource = [
    readFileStrict(files.shellDynamic, ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-chat-state.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-playlist-rail.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-performance-metrics.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-desktop-intro.ts'), ROOT),
    readFileStrict(path.join(ROOT, 'apps/web/components/use-search-autocomplete.ts'), ROOT),
  ].join('\n');
  const historyPageSource = readFileStrict(files.historyPage, ROOT);
  const favouritesPageSource = readFileStrict(files.favouritesPage, ROOT);
  const playlistsPageSource = readFileStrict(files.playlistsPage, ROOT);
  const playlistDetailPageSource = readFileStrict(files.playlistDetailPage, ROOT);
  const adminPageSource = readFileStrict(files.adminPage, ROOT);
  const adminAuthSource = readFileStrict(files.adminAuth, ROOT);
  const authRequestSource = readFileStrict(files.authRequest, ROOT);
  const serverAuthSource = readFileStrict(files.serverAuth, ROOT);
  const authModalSource = readFileStrict(files.authModal, ROOT);
  const playerExperienceSource = readFileStrict(files.playerExperience, ROOT);
  const authCookiesSource = readFileStrict(files.authCookies, ROOT);
  const rateLimitLibSource = readFileStrict(files.rateLimitLib, ROOT);
  const prismaTypesSource = readFileStrict(files.prismaTypes, ROOT);
  const authSessionsSource = readFileStrict(files.authSessions, ROOT);
  const authTokenRecordsSource = readFileStrict(files.authTokenRecords, ROOT);
  const authAuditSource = readFileStrict(files.authAudit, ROOT);
  const globalCssSource = collectCssFiles(files.appRoot)
    .map((filePath) => readFileStrict(filePath, ROOT))
    .join("\n");

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

  // --- Login API route ---
  assertContains(loginRouteSource, "export async function POST", "Login API exposes POST handler", failures);
  assertContains(loginRouteSource, "verifySameOrigin(request)", "Login API enforces same-origin CSRF protection", failures);
  assertContains(loginRouteSource, "rateLimitOrResponse(request, `auth:login:${normalizedEmail}`, 10, 15 * 60 * 1000)", "Login API applies per-identifier auth rate limiting", failures);
  assertContains(loginRouteSource, 'detail: "Login rate limited"', "Login API records audit events for rate-limited attempts", failures);

  // --- Reset password API route ---
  assertContains(resetPasswordRouteSource, "export async function POST", "Reset-password API exposes POST handler", failures);
  assertContains(resetPasswordRouteSource, "verifySameOrigin(request)", "Reset-password API enforces same-origin CSRF protection", failures);
  assertContains(resetPasswordRouteSource, "rateLimitOrResponse(request, `auth:reset-password:${parsed.data.token}`, 8, 15 * 60 * 1000)", "Reset-password API applies per-token rate limiting", failures);
  assertContains(resetPasswordRouteSource, 'detail: "Reset password rate limited"', "Reset-password API records audit events for rate-limited attempts", failures);
  assertContains(resetPasswordRouteSource, "consumePasswordResetToken(parsed.data.token)", "Reset-password API consumes one-time reset token", failures);

  // --- Verify email API route ---
  assertContains(verifyEmailRouteSource, "export async function GET", "Verify-email API exposes GET handler", failures);
  assertContains(verifyEmailRouteSource, "consumeEmailVerificationToken(parsed.data.token)", "Verify-email API consumes one-time verification token", failures);
  assertContains(verifyEmailRouteSource, '"/verify-email?status=invalid"', "Verify-email API redirects invalid tokens to invalid status", failures);
  assertContains(verifyEmailRouteSource, '"/verify-email?status=success"', "Verify-email API redirects valid tokens to success status", failures);

  // --- Upgrade-to-email API route ---
  assertContains(upgradeToEmailRouteSource, "export async function POST", "Upgrade-to-email API exposes POST handler", failures);
  assertContains(upgradeToEmailRouteSource, "requireApiAuth(request)", "Upgrade-to-email API requires authenticated session", failures);
  assertContains(upgradeToEmailRouteSource, "verifySameOrigin(request)", "Upgrade-to-email API enforces same-origin CSRF protection", failures);
  assertContains(upgradeToEmailRouteSource, "createEmailVerificationToken(upgraded.id)", "Upgrade-to-email API issues email verification tokens", failures);
  assertContains(upgradeToEmailRouteSource, "sendVerificationEmail(upgraded.email ?? email, verificationToken)", "Upgrade-to-email API sends verification email after upgrade", failures);

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

  // --- Shared Prisma wrapper typing contract ---
  assertContains(prismaTypesSource, "export type PrismaWithVerifiedUser", "Shared prisma-types exports PrismaWithVerifiedUser", failures);
  assertContains(prismaTypesSource, "export type PrismaWithProfileUser", "Shared prisma-types exports PrismaWithProfileUser", failures);
  assertContains(prismaTypesSource, "export type PrismaWithVerificationEmailUser", "Shared prisma-types exports PrismaWithVerificationEmailUser", failures);
  assertContains(prismaTypesSource, "export type PrismaWithAuthSession", "Shared prisma-types exports PrismaWithAuthSession", failures);
  assertContains(prismaTypesSource, "export type PrismaWithTokenModels", "Shared prisma-types exports PrismaWithTokenModels", failures);
  assertContains(prismaTypesSource, "export type PrismaWithAuthAudit", "Shared prisma-types exports PrismaWithAuthAudit", failures);
  assertContains(serverAuthSource, 'from "@/lib/prisma-types"', "Server auth imports shared prisma wrapper types", failures);
  assertNotContains(serverAuthSource, "type PrismaWithVerifiedUser =", "Server auth no longer redeclares PrismaWithVerifiedUser locally", failures);
  assertContains(profileRouteSource, 'from "@/lib/prisma-types"', "Profile route imports shared prisma wrapper types", failures);
  assertNotContains(profileRouteSource, "type PrismaWithProfileUser =", "Profile route no longer redeclares PrismaWithProfileUser locally", failures);
  assertContains(sendVerificationRouteSource, 'from "@/lib/prisma-types"', "Send-verification route imports shared prisma wrapper types", failures);
  assertNotContains(sendVerificationRouteSource, "type PrismaWithVerifiedUser =", "Send-verification route no longer redeclares PrismaWithVerifiedUser locally", failures);
  assertContains(authSessionsSource, 'from "@/lib/prisma-types"', "Auth sessions module imports shared prisma wrapper types", failures);
  assertContains(authTokenRecordsSource, 'from "@/lib/prisma-types"', "Auth token records module imports shared prisma wrapper types", failures);
  assertContains(authAuditSource, 'from "@/lib/prisma-types"', "Auth audit module imports shared prisma wrapper types", failures);
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

  // --- Rate limiter library contract ---
  assertContains(rateLimitLibSource, "const ipBucket = new Map<string, RateEntry>();", "Rate limiter keeps an IP-scoped bucket map", failures);
  assertContains(rateLimitLibSource, "const sharedBucket = new Map<string, RateEntry>();", "Rate limiter keeps a shared bucket map", failures);
  assertContains(rateLimitLibSource, "const PRUNE_INTERVAL_MS = 60_000;", "Rate limiter defines periodic pruning interval", failures);
  assertContains(rateLimitLibSource, "function pruneExpiredEntries(now: number)", "Rate limiter exposes expired-entry pruning helper", failures);
  assertContains(rateLimitLibSource, "if (!current || now >= current.resetAt)", "Rate limiter opens a new fixed window when key is missing or expired", failures);
  assertContains(rateLimitLibSource, "map.set(key, { count: 1, resetAt: now + windowMs });", "Rate limiter initializes a fixed window with count=1 and resetAt", failures);
  assertContains(rateLimitLibSource, "if (current.count >= limit)", "Rate limiter blocks requests once the fixed-window count reaches the limit", failures);
  assertContains(rateLimitLibSource, "{ status: 429, headers: { \"Retry-After\": String(retryAfter) } }", "Rate limiter returns HTTP 429 with Retry-After header", failures);
  assertContains(rateLimitLibSource, 'const key = `${getClientIp(request)}:${keySuffix}`;', "IP limiter keys buckets by client IP plus suffix", failures);
  assertContains(rateLimitLibSource, "return checkBucket(sharedBucket, key, limit, windowMs, now);", "Shared limiter path uses shared bucket checks", failures);

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
  assertContains(anonymousRouteSource, 'import { parseRequestJson } from "@/lib/request-json";', "Anonymous auth API uses shared JSON parser helper", failures);
  assertContains(anonymousRouteSource, "const bodyResult = await parseRequestJson<AnonymousRequestBody>(request);", "Anonymous auth API parses POST body via shared JSON helper", failures);
  assertNotContains(anonymousRouteSource, "request.json().catch(() => null)", "Anonymous auth API avoids bespoke request.json catch parsing", failures);

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

  // --- AuthModal: deferred in-app login/register modal ---
  assertContains(authModalSource, 'className="authModal"', "AuthModal renders with authModal root class", failures);
  assertContains(authModalSource, 'className="authModalBackdrop"', "AuthModal renders a backdrop element", failures);
  assertContains(authModalSource, 'className="authModalPanel"', "AuthModal renders a panel container", failures);
  assertContains(authModalSource, "AuthLoginForm", "AuthModal renders the login form", failures);
  assertContains(authModalSource, "AuthRegisterForm", "AuthModal renders the register form", failures);
  assertContains(authModalSource, "AuthForgotPasswordForm", "AuthModal renders the forgot password form", failures);

  // --- Shell: AuthModal integration ---
  assertContains(shellDynamicSource, "const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);", "Shell tracks auth modal open state", failures);
  assertContains(shellDynamicSource, "function openAuthModal()", "Shell exposes an openAuthModal function", failures);
  assertContains(shellDynamicSource, "<AuthModal", "Shell renders the AuthModal component", failures);
  assertContains(shellDynamicSource, "isOpen={isAuthModalOpen}", "Shell passes isOpen prop to AuthModal", failures);
  assertContains(shellDynamicSource, "onClose={() => setIsAuthModalOpen(false)}", "Shell passes onClose handler to AuthModal", failures);

  // --- Player auth wall: guest-facing sign-in overlay ---
  assertContains(playerExperienceSource, 'className="playerAuthWall"', "PlayerExperience renders a playerAuthWall overlay for unauthenticated users", failures);
  assertContains(playerExperienceSource, "suppressAuthWall", "PlayerExperience supports suppressAuthWall prop to hide the wall on magazine routes", failures);
  assertContains(playerExperienceSource, "onAuthRequired", "PlayerExperience exposes onAuthRequired callback for sign-in CTA", failures);
  assertContains(shellDynamicSource, "suppressAuthWall={!isAuthenticated && isMagazineOverlayRoute}", "Shell suppresses player auth wall on magazine overlay routes", failures);

  // --- CSS: auth modal and player auth wall ---
  assertContains(globalCssSource, ".authModal", "globals.css defines .authModal styles", failures);
  assertContains(globalCssSource, ".authModalBackdrop", "globals.css defines .authModalBackdrop styles", failures);
  assertContains(globalCssSource, ".authModalPanel", "globals.css defines .authModalPanel styles", failures);
  assertContains(globalCssSource, ".playerAuthWall", "globals.css defines .playerAuthWall overlay styles", failures);
  assertContains(globalCssSource, ".playerAuthWallBtn", "globals.css defines .playerAuthWallBtn CTA button style", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Auth invariant check failed.",
    successMessage: "Auth invariant check passed.",
  });
}

main();
