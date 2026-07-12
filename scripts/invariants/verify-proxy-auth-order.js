/**
 * Invariant: proxy auth order — silent refresh runs before mobile redirect
 *
 * Verifies that the proxy middleware correctly orders the silent auth
 * refresh check before the mobile-device redirect, so returning mobile
 * users get their session refreshed before being redirected to /m.
 *
 * Guards against:
 * - Accidental re-ordering that puts mobile redirect before silent refresh
 * - Removal of the silent-refresh block
 * - Duplicate silent-refresh blocks (from partial patch application)
 * - Missing readAuthCookies import
 * - Missing verifyToken import
 */

const fs = require("node:fs");
const path = require("node:path");

const proxyPath = path.resolve(__dirname, "..", "..", "apps", "web", "proxy.ts");
const source = fs.readFileSync(proxyPath, "utf-8");

// ── Split into lines for positional checks ────────────────────────────────
const lines = source.split(/\r?\n/);

// ── Check 1: readAuthCookies is imported ───────────────────────────────────
if (!source.includes('import { readAuthCookies } from')) {
  console.error("[FAIL] proxy.ts missing readAuthCookies import");
  process.exit(1);
}
console.log("[ok] readAuthCookies imported");

// ── Check 2: verifyToken is imported ───────────────────────────────────────
if (!source.includes('import { verifyToken } from')) {
  console.error("[FAIL] proxy.ts missing verifyToken import");
  process.exit(1);
}
console.log("[ok] verifyToken imported");

// ── Check 3: isBrowserPageNav condition exists (silent refresh guard) ──────
if (!source.includes("const isBrowserPageNav")) {
  console.error("[FAIL] proxy.ts missing isBrowserPageNav condition");
  process.exit(1);
}
console.log("[ok] isBrowserPageNav condition present");

// ── Check 4: isBrowserPageNav excludes API routes ──────────────────────────
const isBrowserPageNavStart = lines.findIndex((line) => line.includes("const isBrowserPageNav"));
if (isBrowserPageNavStart === -1) {
  console.error("[FAIL] isBrowserPageNav definition not found on a single line");
  process.exit(1);
}

// Check the next ~8 lines for !pathname.startsWith("/api")
const isBrowserPageNavBlock = lines.slice(isBrowserPageNavStart, isBrowserPageNavStart + 10).join("\n");
if (!isBrowserPageNavBlock.includes('!pathname.startsWith("/api")')) {
  console.error("[FAIL] isBrowserPageNav does not exclude /api routes");
  process.exit(1);
}
console.log("[ok] isBrowserPageNav excludes /api routes");

// ── Check 5: silent-refresh redirect points to the correct endpoint ────────
if (!source.includes('"/api/auth/silent-refresh"')) {
  console.error("[FAIL] proxy.ts missing silent-refresh redirect target");
  process.exit(1);
}
console.log("[ok] silent-refresh redirects to /api/auth/silent-refresh");

// ── Check 6: silent refresh block exists ───────────────────────────────────
const silentRefreshIfIndex = lines.findIndex(
  (line) => line.includes("if (isBrowserPageNav)")
);
if (silentRefreshIfIndex === -1) {
  console.error("[FAIL] proxy.ts missing `if (isBrowserPageNav)` block");
  process.exit(1);
}
console.log("[ok] silent refresh `if (isBrowserPageNav)` block present");

// ── Check 7: mobile redirect block exists ──────────────────────────────────
const mobileRedirectIfIndex = lines.findIndex(
  (line) => line.includes("if (shouldRedirectToMobile)")
);
if (mobileRedirectIfIndex === -1) {
  console.error("[FAIL] proxy.ts missing `if (shouldRedirectToMobile)` block");
  process.exit(1);
}
console.log("[ok] mobile redirect `if (shouldRedirectToMobile)` block present");

// ── Check 8: Silent refresh runs BEFORE mobile redirect (positional) ───────
// This is the critical invariant for the fix.
if (silentRefreshIfIndex >= mobileRedirectIfIndex) {
  console.error(
    "[FAIL] silent refresh block (line %d) does not run before mobile redirect (line %d). " +
    "Mobile returning users would be redirected before session refresh.",
    silentRefreshIfIndex + 1,
    mobileRedirectIfIndex + 1,
  );
  process.exit(1);
}
console.log(
  "[ok] silent refresh (line %d) runs before mobile redirect (line %d)",
  silentRefreshIfIndex + 1,
  mobileRedirectIfIndex + 1,
);

// ── Check 9: No duplicate isBrowserPageNav blocks ──────────────────────────
const isBrowserPageNavCount = (source.match(/const isBrowserPageNav/g) || []).length;
if (isBrowserPageNavCount !== 1) {
  console.error(
    "[FAIL] proxy.ts contains %d isBrowserPageNav definitions (expected 1) — " +
    "possible duplicate block from partial patch application",
    isBrowserPageNavCount,
  );
  process.exit(1);
}
console.log("[ok] single isBrowserPageNav definition (no duplicates)");

// ── Check 10: No duplicate silent-refresh redirect blocks ──────────────────
const silentRefreshUrlCount = (source.match(/\/api\/auth\/silent-refresh/g) || []).length;
if (silentRefreshUrlCount !== 1) {
  console.error(
    "[FAIL] proxy.ts contains %d silent-refresh redirect references (expected 1) — " +
    "possible duplicate block from partial patch application",
    silentRefreshUrlCount,
  );
  process.exit(1);
}
console.log("[ok] single silent-refresh redirect reference (no duplicates)");

// ── Check 11: shouldRedirectToMobile excludes /m paths (prevents redirect loop) ──
const shouldRedirectToMobileStart = lines.findIndex(
  (line) => line.includes("const shouldRedirectToMobile")
);
if (shouldRedirectToMobileStart === -1) {
  console.error("[FAIL] shouldRedirectToMobile definition not found");
  process.exit(1);
}
const mobileBlock = lines.slice(shouldRedirectToMobileStart, shouldRedirectToMobileStart + 15).join("\n");
if (!mobileBlock.includes('!pathname.startsWith("/m")')) {
  console.error("[FAIL] shouldRedirectToMobile does not exclude /m paths (risks redirect loop)");
  process.exit(1);
}
console.log("[ok] shouldRedirectToMobile excludes /m paths");

// ── Check 12: The proxy function reads accessToken after both redirect blocks ──
// This ensures the API auth section still runs after the browser-page logic.
const accessTokenReadIndex = lines.findIndex(
  (line) => line.includes("const { accessToken } = readAuthCookies(request)")
);
if (accessTokenReadIndex === -1) {
  console.error("[FAIL] proxy.ts missing accessToken read for API auth section");
  process.exit(1);
}
if (accessTokenReadIndex <= mobileRedirectIfIndex) {
  console.error(
    "[FAIL] accessToken read (line %d) appears before mobile redirect (line %d) — " +
    "API auth section may be incorrectly ordered",
    accessTokenReadIndex + 1,
    mobileRedirectIfIndex + 1,
  );
  process.exit(1);
}
console.log("[ok] accessToken read for API auth follows both redirect blocks");

console.log("\nProxy auth order invariants passed.");
