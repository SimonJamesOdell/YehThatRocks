#!/usr/bin/env node

// Domain: Proxy middleware (mobile routing + security headers)
// Guards against the regression introduced in commit cb56dd99, which removed
// the mobile UA redirect AND its vitest suite AND the old proxy invariant in a
// single "remove dead code" sweep. These behaviors were load-bearing.
//
// This invariant asserts:
//   - apps/web/proxy.ts still contains mobile UA detection, /m path mapping,
//     static-asset and crawler exclusions, the desktop-only escape hatch, the
//     no-redirect-loop guard, the /api exclusion, and security headers.
//   - apps/web/proxy.test.ts still exists AND still asserts the redirect +
//     security-header behaviors, so the test cannot be silently deleted.

const path = require("node:path");
const {
  readFileStrict,
  mapRelativeFiles,
  assertFilesExist,
  assertContains,
  finishInvariantCheck,
} = require("./lib/test-harness");

const ROOT = process.cwd();

const files = mapRelativeFiles(ROOT, {
  proxy: "apps/web/proxy.ts",
  proxyTest: "apps/web/proxy.test.ts",
});

function main() {
  const failures = [];

  // ── 1. Both the proxy and its test suite must exist ──────────────────
  // The test file is deliberately required: the regression deleted the test
  // alongside the code, which is what let it slip through review.
  assertFilesExist(
    {
      proxy: files.proxy,
      proxyTest: files.proxyTest,
    },
    failures,
    ROOT,
  );

  const proxySource = readFileStrict(files.proxy, ROOT);
  const testSource = readFileStrict(files.proxyTest, ROOT);

  // ── 2. Mobile UA detection ───────────────────────────────────────────
  assertContains(proxySource, "MOBILE_OR_TABLET_USER_AGENT_PATTERN", "proxy defines a mobile/tablet user-agent pattern", failures);
  assertContains(proxySource, "sec-ch-ua-mobile", "proxy checks the sec-ch-ua-mobile client hint", failures);
  assertContains(proxySource, "isMobileOrTabletRequest", "proxy defines isMobileOrTabletRequest", failures);

  // ── 3. /m path mapping ───────────────────────────────────────────────
  assertContains(proxySource, "resolveMobilePathname", "proxy defines resolveMobilePathname", failures);
  assertContains(proxySource, 'return "/m"', "proxy maps unmatched routes to /m", failures);
  assertContains(proxySource, 'return "/m/register"', "proxy maps /register to /m/register", failures);

  // ── 4. Redirect exclusions (must never redirect these) ───────────────
  assertContains(proxySource, "isStaticAssetPath", "proxy defines isStaticAssetPath", failures);
  assertContains(proxySource, "isMetadataCrawlerRequest", "proxy defines isMetadataCrawlerRequest", failures);
  assertContains(proxySource, 'pathname !== "/desktop-only"', "proxy excludes /desktop-only from mobile redirect", failures);
  assertContains(proxySource, '!pathname.startsWith("/m")', "proxy avoids redirect loops on /m", failures);
  assertContains(proxySource, '!pathname.startsWith("/api")', "proxy never redirects API routes", failures);
  assertContains(proxySource, "isDesktopOnlyContentRoute", "proxy keeps desktop-only content routes on desktop", failures);

  // ── 5. The redirect itself ───────────────────────────────────────────
  assertContains(proxySource, "NextResponse.redirect", "proxy issues a mobile redirect", failures);
  assertContains(proxySource, "resolveMobilePathname(pathname)", "proxy redirects through resolveMobilePathname", failures);

  // ── 6. Security headers ──────────────────────────────────────────────
  assertContains(proxySource, "X-Frame-Options", "proxy sets X-Frame-Options", failures);
  assertContains(proxySource, "X-Content-Type-Options", "proxy sets X-Content-Type-Options", failures);
  assertContains(proxySource, "Referrer-Policy", "proxy sets Referrer-Policy", failures);
  assertContains(proxySource, "Strict-Transport-Security", "proxy sets Strict-Transport-Security", failures);
  assertContains(proxySource, 'startsWith("/embed/")', "proxy exempts /embed from X-Frame-Options DENY", failures);

  // ── 7. Existing header injection must be preserved ───────────────────
  assertContains(proxySource, "x-ytr-pathname", "proxy still injects x-ytr-pathname", failures);
  assertContains(proxySource, "x-ytr-search", "proxy still injects x-ytr-search", failures);

  // ── 8. The vitest suite must assert the same behaviors ────────────────
  assertContains(testSource, "resolveMobilePathname", "proxy.test.ts covers resolveMobilePathname", failures);
  assertContains(testSource, "isMobileOrTabletRequest", "proxy.test.ts covers mobile detection", failures);
  assertContains(testSource, "redirect", "proxy.test.ts asserts the mobile redirect", failures);
  assertContains(testSource, "X-Frame-Options", "proxy.test.ts asserts security headers", failures);
  assertContains(testSource, "isStaticAssetPath", "proxy.test.ts covers static-asset exclusion", failures);

  finishInvariantCheck({
    failures,
    failureHeader: "\nProxy mobile-routing invariants FAILED:",
    successMessage: "\nAll proxy mobile-routing invariants passed.",
  });
}

main();
