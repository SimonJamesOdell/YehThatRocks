#!/usr/bin/env node

const path = require("node:path");
const {
  readFileStrict,
  assertContains,
  finishInvariantCheck,
} = require("./invariants/helpers");

const ROOT = process.cwd();
const FILE = path.join(ROOT, "scripts", "magazine-facebook-browser-open.js");

function assertOrder(source, markers, failures) {
  let lastIndex = -1;

  for (const marker of markers) {
    const index = source.indexOf(marker);
    if (index === -1) {
      failures.push(`Missing required flow marker: ${marker}`);
      continue;
    }

    if (index < lastIndex) {
      failures.push(`Flow order violated around marker: ${marker}`);
    }

    lastIndex = index;
  }
}

function main() {
  const failures = [];
  const source = readFileStrict(FILE, ROOT);

  // Core safety: the launcher must derive and paste latest magazine URL by default.
  assertContains(
    source,
    "async function resolveLatestMagazineUrl(appUrl)",
    "Launcher resolves latest magazine article URL before posting",
    failures,
  );
  assertContains(
    source,
    "const pasteUrl = String(process.env.MAGAZINE_BROWSER_PASTE_URL || (await resolveLatestMagazineUrl(appUrl))).trim();",
    "Launcher defaults paste URL to latest magazine article when override is not provided",
    failures,
  );

  // Selector invariants: avoid brittle generated class selectors.
  assertContains(
    source,
    "normalizeText(button.getAttribute(\"aria-label\")) === \"Next\"",
    "Next button resolution uses stable aria-label",
    failures,
  );
  assertContains(
    source,
    "normalizeText(button.getAttribute(\"aria-label\")) === \"Post\"",
    "Post button resolution uses stable aria-label",
    failures,
  );
  assertContains(
    source,
    "label.closest('[role=\"button\"]')",
    "Button fallback resolution uses semantic role traversal",
    failures,
  );

  // Flow order invariants for the known-good posting sequence.
  assertOrder(
    source,
    [
      "element.scrollTop += 1200;",
      "const clickResult = await clickWhatsOnYourMind(page);",
      "const pasteResult = await pasteUrlAtCurrentFocus(page, pasteUrl);",
      "await page.waitForTimeout(5000);",
      "const nextResult = await clickNextButton(page);",
      "await page.waitForTimeout(2000);",
      "const postResult = await clickPostButton(page);",
    ],
    failures,
  );

  // Logging invariants help detect stale/partial runs quickly.
  assertContains(
    source,
    "console.log(`[launcher] Next result: ${JSON.stringify(nextResult)}`);",
    "Launcher logs Next step result",
    failures,
  );
  assertContains(
    source,
    "console.log(`[launcher] Post result: ${JSON.stringify(postResult)}`);",
    "Launcher logs Post step result",
    failures,
  );

  finishInvariantCheck({
    failures,
    failureHeader: "Magazine browser open flow invariant check failed.",
    successMessage: "Magazine browser open flow invariant check passed.",
  });
}

main();