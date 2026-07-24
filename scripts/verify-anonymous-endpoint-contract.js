#!/usr/bin/env node

// Domain: Anonymous Auth Endpoint Contract
// Verifies the structural contract of GET/POST /api/auth/anonymous
// that both AnonymousSignupModal and AuthLoginForm depend on.

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = {
  route: path.join(ROOT, "apps/web/app/api/auth/anonymous/route.ts"),
};

function main() {
  const failures = [];

  const routeSource = readFileStrict(files.route, ROOT);

  // ── Route exports ─────────────────────────────────────────────────────────

  assertContains(routeSource, "export async function GET", "Anonymous route exports GET handler", failures);
  assertContains(routeSource, "export async function POST", "Anonymous route exports POST handler", failures);

  // ── GET handler: screen-name suggestion / availability check ──────────────

  // GET returns a screenName suggestion
  assertContains(routeSource, "screenName", "GET handler includes screenName in response", failures);

  // GET supports ?screenName= query parameter for availability check
  assertContains(routeSource, "searchParams.get", "GET handler reads query parameters", failures);

  // ── POST handler: account creation ────────────────────────────────────────

  // POST accepts { screenName } in body
  assertContains(routeSource, "screenName", "POST handler reads screenName from request body", failures);

  // POST creates credentials (username + password)
  assertContains(routeSource, "username", "POST handler returns username in credentials", failures);
  assertContains(routeSource, "password", "POST handler returns password in credentials", failures);

  // POST returns credentials in response body
  assertContains(routeSource, "credentials", "POST handler returns credentials object", failures);

  // ── Auto screen-name generation ───────────────────────────────────────────

  // When no screenName is provided (or too short), auto-generate one
  assertContains(routeSource, "Auto-generate", "GET handler auto-generates screen name when none provided", failures);
  assertContains(routeSource, "buildAnonymousScreenNameSuggestion", "Anonymous route uses screen-name suggestion builder", failures);

  // ── Rate limiting ─────────────────────────────────────────────────────────

  assertContains(routeSource, "rateLimit", "Anonymous route applies rate limiting", failures);

  // ── Audit logging ─────────────────────────────────────────────────────────

  assertContains(routeSource, "recordAuthAudit", "Anonymous route records auth audit events", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "Anonymous endpoint contract check failed.",
    successMessage: "Anonymous endpoint contract check passed.",
  });
}

main();
