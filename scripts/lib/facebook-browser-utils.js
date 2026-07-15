"use strict";

// ---------------------------------------------------------------------------
// facebook-browser-utils — shared Playwright/Chromium browser automation for
// Facebook group posting. Extracted from magazine-facebook-browser-post.js so
// the unified facebook-browser-post.js can reuse the same machinery across all
// post modes (magazine, spotlight, versus, discussion, roundup, trivia).
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

// ---------------------------------------------------------------------------
// Chromium loader
// ---------------------------------------------------------------------------

let _chromium = null;

function loadChromium() {
  if (_chromium) return _chromium;

  try {
    _chromium = require("playwright").chromium;
    return _chromium;
  } catch {
    // Fall through to the test package when running inside the main repo.
  }

  try {
    _chromium = require("@playwright/test").chromium;
    return _chromium;
  } catch {
    // Fall through to the terminal error below.
  }

  throw new Error("Playwright is not installed. Install either 'playwright' or '@playwright/test'.");
}

// ---------------------------------------------------------------------------
// CLI / env helpers
// ---------------------------------------------------------------------------

function hasArg(flag) {
  return process.argv.includes(flag);
}

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) {
    return null;
  }

  return {
    key: match[1],
    value: match[2].replace(/^"/, "").replace(/"$/, ""),
  };
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed || process.env[parsed.key]) {
      continue;
    }
    process.env[parsed.key] = parsed.value;
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function resolveHomePath(...segments) {
  return path.join(os.homedir(), ...segments);
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateFacebookTargetUrl(targetUrl) {
  const normalized = String(targetUrl || "").trim();
  if (!normalized) {
    throw new Error("FB_BROWSER_POST_GROUP_URL must be set");
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`FB_BROWSER_POST_GROUP_URL is not a valid URL: ${normalized}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "www.facebook.com" && hostname !== "facebook.com" && hostname !== "m.facebook.com") {
    throw new Error(
      `FB_BROWSER_POST_GROUP_URL must point to a Facebook URL. Received: ${normalized}`,
    );
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

function acquireLock(lockPath) {
  ensureDirFor(lockPath);

  try {
    const lockStats = fs.statSync(lockPath);
    const ageMs = Date.now() - lockStats.mtimeMs;
    if (ageMs > 2 * 60 * 60 * 1000) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // No existing lock or unreadable state; continue to create a new one.
  }

  let fd;
  try {
    fd = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(`Another browser post run is already active: ${lockPath}`);
    }
    throw error;
  }

  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2));

  return () => {
    try {
      fs.closeSync(fd);
    } catch {
      // Ignore close failures during cleanup.
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore cleanup failures.
    }
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {
      posted: [],
      lastCheckedAt: null,
      lastSeenSlug: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      posted: Array.isArray(parsed.posted) ? parsed.posted : [],
      lastCheckedAt: typeof parsed.lastCheckedAt === "string" ? parsed.lastCheckedAt : null,
      lastSeenSlug: typeof parsed.lastSeenSlug === "string" ? parsed.lastSeenSlug : null,
    };
  } catch {
    return {
      posted: [],
      lastCheckedAt: null,
      lastSeenSlug: null,
    };
  }
}

function writeState(statePath, state) {
  ensureDirFor(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function maybeClick(locator, timeout = 1500) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    await locator.first().click();
    return true;
  } catch {
    return false;
  }
}

async function dismissCookieBanners(page) {
  const candidates = [
    page.getByRole("button", { name: /allow all cookies/i }),
    page.getByRole("button", { name: /allow essential and optional cookies/i }),
    page.getByRole("button", { name: /only allow essential cookies/i }),
    page.getByRole("button", { name: /accept all/i }),
  ];

  for (const candidate of candidates) {
    const clicked = await maybeClick(candidate, 1000);
    if (clicked) {
      return true;
    }
  }

  return false;
}

async function getComposerTextbox(root) {
  const candidates = [
    root.locator('div[contenteditable="true"]').last(),
    root.locator('div[role="textbox"][contenteditable="true"]').last(),
    root.locator('div[role="textbox"]').last(),
  ];

  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: "visible", timeout: 4000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

async function getPostDialog(page, timeout = 4000) {
  const candidate = page.locator('div[role="dialog"]').last();
  try {
    await candidate.waitFor({ state: "visible", timeout });
    return candidate;
  } catch {
    return null;
  }
}

async function openComposer(page) {
  // If dialog is already open nothing to do.
  const existingDialog = await getPostDialog(page, 500);
  if (existingDialog) {
    return;
  }

  // Scroll slightly so the composer card is fully visible.
  await page.evaluate(() => window.scrollBy(0, 150));
  await page.waitForTimeout(800);

  // Click the "What's on your mind?" span that opens the Create Post dialog.
  const openerSelectors = [
    'span:has-text("What\'s on your mind?")',
    '[aria-label*="Create a post"]',
    '[aria-label*="What\'s on your mind"]',
    'div[role="button"]:has(span:has-text("What\'s on your mind"))',
    'div[role="complementary"] div[role="button"]',
  ];

  for (const sel of openerSelectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: "visible", timeout: 5000 });
      console.log(`[facebook-browser] Found composer opener via: ${sel}`);
      await el.click();
      // Wait for the Create Post dialog — Facebook will focus the textbox automatically.
      const dialog = await getPostDialog(page, 5000);
      if (dialog) {
        return;
      }
    } catch {
      // Try the next opener.
    }
  }

  throw new Error("Could not open the Facebook Create Post dialog");
}

async function findPostButton(page) {
  const dialog = await getPostDialog(page);
  const scope = dialog || page;

  const candidates = [
    scope.locator('[role="button"]:has(span:text-is("Next"))').last(),
    scope.locator('[role="button"]:has(span:text-is("Create"))').last(),
    scope.locator('[role="button"]:has(span:text-is("Post"))').last(),
    scope.locator('[role="button"]:has(span:text-is("Publish"))').last(),
    scope.locator('[role="button"]:has(span:text-is("Share now"))').last(),
    scope.getByRole("button", { name: /^Next$/i }).last(),
    scope.getByRole("button", { name: /^Create$/i }).last(),
    scope.getByRole("button", { name: /^Post$/i }).last(),
    scope.getByRole("button", { name: /^Publish$/i }).last(),
    scope.getByRole("button", { name: /^Share now$/i }).last(),
    scope.getByRole("button", { name: /post|publish|share now|create|next/i }).last(),
    scope.locator('div[role="button"][aria-label*="Post"]').last(),
    scope.locator('div[role="button"][aria-label*="Publish"]').last(),
    scope.locator('div[role="button"][aria-label*="Share"]').last(),
    scope.locator('div[aria-label="Post"]').last(),
    scope.locator('div[role="button"]').filter({ hasText: /post|publish|share now|next|create/i }).last(),
  ];

  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: "visible", timeout: 5000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Could not find the Facebook Post button");
}

async function clickNextSpan(page) {
  let lastLabels = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await page.evaluate(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden"
          && style.display !== "none"
          && rect.width > 0
          && rect.height > 0;
      };

      const nextButton = Array.from(document.querySelectorAll('[aria-label="Next"][role="button"]'))
        .find((element) => isVisible(element));

      if (nextButton) {
        nextButton.scrollIntoView({ block: "center", inline: "center" });
        nextButton.click();
        nextButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return { clicked: true, match: "aria-label-button" };
      }

      const spans = Array.from(document.querySelectorAll("span"));
      const target = spans.find((span) => {
        if (!isVisible(span)) {
          return false;
        }
        return span.textContent && span.textContent.trim().toLowerCase() === "next";
      });

      if (!target) {
        return {
          clicked: false,
          availableLabels: spans
            .filter((span) => isVisible(span))
            .map((span) => (span.textContent || "").trim())
            .filter(Boolean)
            .slice(0, 50),
        };
      }

      target.scrollIntoView({ block: "center", inline: "center" });
      const clickTarget = target.closest('[role="button"]') || target;
      if (clickTarget instanceof HTMLElement && typeof clickTarget.click === "function") {
        clickTarget.click();
      }
      clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

      return { clicked: true, match: "next-span" };
    });

    if (result && result.clicked) {
      console.log(`[facebook-browser] Clicked Next via ${result.match}.`);
      return;
    }

    lastLabels = Array.isArray(result?.availableLabels) ? result.availableLabels : [];
    await page.waitForTimeout(500);
  }

  const labels = lastLabels.length > 0 ? lastLabels.join(" | ") : "none";
  throw new Error(`Could not find the Facebook Next span. Visible span labels: ${labels}`);
}

async function clickPostButton(page) {
  let lastLabels = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await page.evaluate(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden"
          && style.display !== "none"
          && rect.width > 0
          && rect.height > 0;
      };

      const postButton = Array.from(document.querySelectorAll('[aria-label="Post"][role="button"]'))
        .find((element) => isVisible(element));

      if (postButton) {
        postButton.scrollIntoView({ block: "center", inline: "center" });
        postButton.click();
        postButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return { clicked: true, match: "aria-label-button" };
      }

      const spans = Array.from(document.querySelectorAll("span"));
      const target = spans.find((span) => {
        if (!isVisible(span)) {
          return false;
        }
        return span.textContent && span.textContent.trim().toLowerCase() === "post";
      });

      if (!target) {
        return {
          clicked: false,
          availableLabels: spans
            .filter((span) => isVisible(span))
            .map((span) => (span.textContent || "").trim())
            .filter(Boolean)
            .slice(0, 50),
        };
      }

      target.scrollIntoView({ block: "center", inline: "center" });
      const clickTarget = target.closest('[role="button"]') || target;
      if (clickTarget instanceof HTMLElement && typeof clickTarget.click === "function") {
        clickTarget.click();
      }
      clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

      return { clicked: true, match: "post-span" };
    });

    if (result && result.clicked) {
      console.log(`[facebook-browser] Clicked Post via ${result.match}.`);
      return;
    }

    lastLabels = Array.isArray(result?.availableLabels) ? result.availableLabels : [];
    await page.waitForTimeout(500);
  }

  const labels = lastLabels.length > 0 ? lastLabels.join(" | ") : "none";
  throw new Error(`Could not find the Facebook Post button. Visible span labels: ${labels}`);
}

async function submitWithKeyboard(page) {
  try {
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(2500);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Interactive helpers
// ---------------------------------------------------------------------------

async function waitForEnter(promptText) {
  process.stdout.write(`${promptText}\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise((resolve) => rl.question("Press Enter here once the browser profile is ready. ", resolve));
  rl.close();
}

// ---------------------------------------------------------------------------
// Browser context
// ---------------------------------------------------------------------------

async function openBrowserContext(profileDir, headed, channel) {
  const chromium = loadChromium();
  return chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    channel: channel || undefined,
    args: ["--disable-dev-shm-usage"],
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

// ---------------------------------------------------------------------------
// Login flow (mode-agnostic)
// ---------------------------------------------------------------------------

async function runLoginFlow(groupUrl, profileDir, channel) {
  const context = await openBrowserContext(profileDir, true, channel);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(groupUrl, { waitUntil: "domcontentloaded" });
    await dismissCookieBanners(page);
    await waitForEnter(
      "A headed browser has been opened on the Linux box. Log into Facebook in that browser and verify the group page loads cleanly.",
    );
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Generalized browser post flow — mode-agnostic
// ---------------------------------------------------------------------------

/**
 * Open a signed-in Chromium session, navigate to the Facebook group, open the
 * composer, paste `message` (pre-built by the caller's mode), and complete the
 * post flow.
 *
 * @param {object} opts
 * @param {string} opts.message          - Pre-built text to paste (URLs, prompts, etc.)
 * @param {string} opts.groupUrl         - Facebook group URL
 * @param {string} opts.profileDir       - Persistent browser profile directory
 * @param {boolean} opts.headed          - Run in headed mode
 * @param {boolean} opts.dryRun          - Log only, don't actually post
 * @param {string} [opts.channel]        - Browser channel override
 * @param {boolean} [opts.pauseBeforeSubmit] - Pause on page 2 before clicking Post
 * @param {boolean} [opts.keepBrowserOpen]   - Keep browser open after flow
 * @param {string} [opts.logPrefix]      - Prefix for console log lines (default: "facebook-browser")
 * @returns {Promise<{submitted: boolean, dryRun?: boolean, pausedBeforeSubmit?: boolean}>}
 */
async function runBrowserPostFlow({
  message,
  groupUrl,
  profileDir,
  headed,
  dryRun,
  channel,
  pauseBeforeSubmit = false,
  keepBrowserOpen = false,
  logPrefix = "facebook-browser",
}) {
  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run", message, groupUrl }, null, 2));
    return { submitted: false, dryRun: true };
  }

  const context = await openBrowserContext(profileDir, headed, channel);
  let inspectionPrompt = keepBrowserOpen
    ? "Run finished. Review the remote Chromium window, then press Enter here to close it."
    : null;
  let pendingError = null;

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(groupUrl, { waitUntil: "domcontentloaded" });
    // Wait for the Facebook SPA to finish rendering the feed/composer area.
    await page.waitForTimeout(2500);
    await dismissCookieBanners(page);

    // Open the Create Post dialog — Facebook automatically focuses the textbox.
    await openComposer(page);
    // Give Facebook's JS a moment to settle focus on the textbox.
    await page.waitForTimeout(600);
    await page.evaluate((text) => navigator.clipboard.writeText(text), message);
    await page.keyboard.press("Control+v");
    console.log(`[${logPrefix}] Message inserted into composer.`);
    await page.waitForTimeout(800);

    // If the message contains a URL, wait for Facebook to build the link preview.
    if (message.includes("http://") || message.includes("https://")) {
      console.log(`[${logPrefix}] Waiting 5 seconds for Facebook to build the link preview.`);
      await page.waitForTimeout(5000);
    } else {
      console.log(`[${logPrefix}] No URL detected — skipping link preview wait.`);
      await page.waitForTimeout(1500);
    }

    console.log(`[${logPrefix}] Looking for Next button.`);
    await clickNextSpan(page);
    console.log(`[${logPrefix}] Waiting 2 seconds for the second page to load.`);
    await page.waitForTimeout(2000);

    if (pauseBeforeSubmit) {
      console.log(`[${logPrefix}] Advanced to page 2 and paused before submit.`);
      if (keepBrowserOpen) {
        inspectionPrompt = "Dialog page 2 is open and submission is paused. Review the remote Chromium window, then press Enter here to close it without posting.";
      }
      return { submitted: false, pausedBeforeSubmit: true, advancedToPage2: true };
    }

    let submitted = false;

    try {
      console.log(`[${logPrefix}] Looking for Post button.`);
      await clickPostButton(page);
      submitted = true;
    } catch {
      submitted = await submitWithKeyboard(page);
    }

    if (!submitted) {
      throw new Error("Could not submit Facebook post using button or keyboard shortcut");
    }

    console.log(`[${logPrefix}] Post submitted. Waiting an additional 15 seconds before shutdown.`);
    await page.waitForTimeout(15000);

    // --pause: keep browser open after first button click so operator can inspect page 2.
    if (hasArg("--pause")) {
      console.log(`[${logPrefix}] PAUSED — browser stays open for 60 seconds so you can inspect page 2.`);
      await page.waitForTimeout(60000);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    console.log(`[${logPrefix}] Waiting 10 seconds for Facebook to complete the post.`);
    await page.waitForTimeout(10000);
    return { submitted: true };
  } catch (error) {
    pendingError = error;
    if (keepBrowserOpen) {
      const msg = error && error.message ? error.message : String(error);
      inspectionPrompt = `Run failed: ${msg}\nInspect the remote Chromium window, then press Enter here to close it.`;
    }
  } finally {
    if (inspectionPrompt) {
      await waitForEnter(inspectionPrompt);
    }
    await context.close();
  }

  if (pendingError) {
    throw pendingError;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Chromium
  loadChromium,

  // CLI / env
  hasArg,
  toBool,
  ensureDirFor,
  parseEnvLine,
  loadEnvFile,

  // Path
  resolveHomePath,
  trimTrailingSlash,

  // Validation
  validateFacebookTargetUrl,

  // Locking
  acquireLock,

  // State
  readState,
  writeState,

  // Browser interaction
  maybeClick,
  dismissCookieBanners,
  getComposerTextbox,
  getPostDialog,
  openComposer,
  findPostButton,
  clickNextSpan,
  clickPostButton,
  submitWithKeyboard,

  // Interactive
  waitForEnter,

  // Context
  openBrowserContext,

  // Flows
  runLoginFlow,
  runBrowserPostFlow,
};
