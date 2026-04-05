#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

const files = {
  loginForm: path.join(ROOT, "apps/web/components/auth-login-form.tsx"),
  changePasswordForm: path.join(ROOT, "apps/web/components/auth-change-password-form.tsx"),
  forgotPasswordForm: path.join(ROOT, "apps/web/components/auth-forgot-password-form.tsx"),
  accountActions: path.join(ROOT, "apps/web/components/auth-account-actions.tsx"),
  loginRoute: path.join(ROOT, "apps/web/app/api/auth/login/route.ts"),
  logoutRoute: path.join(ROOT, "apps/web/app/api/auth/logout/route.ts"),
  changePasswordRoute: path.join(ROOT, "apps/web/app/api/auth/change-password/route.ts"),
  forgotPasswordRoute: path.join(ROOT, "apps/web/app/api/auth/forgot-password/route.ts"),
  sendVerificationRoute: path.join(ROOT, "apps/web/app/api/auth/send-verification/route.ts"),
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

function main() {
  const failures = [];

  const loginFormSource = read(files.loginForm);
  const changePasswordFormSource = read(files.changePasswordForm);
  const forgotPasswordFormSource = read(files.forgotPasswordForm);
  const accountActionsSource = read(files.accountActions);
  const globalCssSource = read(files.globalCss);

  // --- Login form ---
  assertContains(loginFormSource, 'name="email"', "Login form has email input field", failures);
  assertContains(loginFormSource, 'type="email"', "Login form email input uses email type", failures);
  assertContains(loginFormSource, 'name="password"', "Login form has password input field", failures);
  assertContains(loginFormSource, 'type="password"', "Login form password input uses password type", failures);
  assertContains(loginFormSource, 'autoComplete="username"', "Login form email input has correct autocomplete", failures);
  assertContains(loginFormSource, 'autoComplete="current-password"', "Login form password input has correct autocomplete", failures);
  assertContains(loginFormSource, 'className="authForm"', "Login form uses authForm CSS class", failures);
  assertContains(loginFormSource, 'className="authMessage"', "Login form renders errors with authMessage class", failures);
  assertContains(loginFormSource, "disabled={isSubmitting}", "Login form disables submit button during submission", failures);
  assertContains(loginFormSource, '"/api/auth/login"', "Login form posts to /api/auth/login", failures);
  assertContains(loginFormSource, 'window.location.assign(', "Login form redirects on success via window.location.assign", failures);
  assertContains(loginFormSource, "`/?v=${encodeURIComponent(videoParam)}`", "Login redirects back to video param when present", failures);

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
