#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

function loadChromium() {
  try {
    return require("playwright").chromium;
  } catch {
    // Fall through to the test package when running inside the main repo.
  }

  try {
    return require("@playwright/test").chromium;
  } catch {
    // Fall through to the terminal error below.
  }

  throw new Error("Playwright is not installed. Install either 'playwright' or '@playwright/test'.");
}

const chromium = loadChromium();

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

function loadEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env.production"),
    path.resolve(process.cwd(), "apps/web/.env.local"),
    path.resolve(process.cwd(), "apps/web/.env.production"),
  ];

  for (const candidatePath of candidatePaths) {
    loadEnvFile(candidatePath);
  }
}

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
      throw new Error(`Another magazine browser post run is already active: ${lockPath}`);
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

function resolveHomePath(...segments) {
  return path.join(os.homedir(), ...segments);
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function validateFacebookTargetUrl(targetUrl) {
  const normalized = String(targetUrl || "").trim();
  if (!normalized) {
    throw new Error("MAGAZINE_BROWSER_POST_GROUP_URL must be set");
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`MAGAZINE_BROWSER_POST_GROUP_URL is not a valid URL: ${normalized}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "www.facebook.com" && hostname !== "facebook.com" && hostname !== "m.facebook.com") {
    throw new Error(
      `MAGAZINE_BROWSER_POST_GROUP_URL must point to a Facebook URL. Received: ${normalized}`,
    );
  }

  return normalized;
}

function buildArticleUrl(appUrl, slug) {
  return `${trimTrailingSlash(appUrl)}/magazine/${encodeURIComponent(String(slug || "").trim())}`;
}

function buildMessage(articleUrl) {
  const prefix = String(process.env.MAGAZINE_BROWSER_POST_MESSAGE_PREFIX || "").trim();
  if (!prefix) {
    return articleUrl;
  }
  return `${prefix}\n\n${articleUrl}`;
}

function shouldKeepBrowserOpen() {
  return hasArg("--keep-open") || toBool(process.env.MAGAZINE_BROWSER_POST_KEEP_OPEN, false);
}

function shouldForceLatestArticle() {
  return hasArg("--force-latest") || toBool(process.env.MAGAZINE_BROWSER_POST_FORCE_LATEST, false);
}

function shouldPauseBeforeSubmit() {
  return hasArg("--pause-before-submit") || toBool(process.env.MAGAZINE_BROWSER_POST_PAUSE_BEFORE_SUBMIT, false);
}

async function fetchLatestArticle(appUrl, apiUrlOverride) {
  const apiUrl = trimTrailingSlash(apiUrlOverride) || `${trimTrailingSlash(appUrl)}/api/magazine/latest?limit=1`;
  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Latest article fetch failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const article = Array.isArray(payload?.articles) ? payload.articles[0] : null;
  if (!article || typeof article.slug !== "string" || !article.slug.trim()) {
    throw new Error("Latest article payload did not include a slug");
  }

  return {
    slug: article.slug.trim(),
    title: typeof article.title === "string" ? article.title.trim() : "",
    artist: typeof article.artist === "string" ? article.artist.trim() : "",
    genre: typeof article.genre === "string" ? article.genre.trim() : "",
    kicker: typeof article.kicker === "string" ? article.kicker.trim() : "",
    articleUrl: buildArticleUrl(appUrl, article.slug),
  };
}

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
      console.log(`[magazine-facebook-browser-post] Found composer opener via: ${sel}`);
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
      console.log(`[magazine-facebook-browser-post] Clicked Next via ${result.match}.`);
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
      console.log(`[magazine-facebook-browser-post] Clicked Post via ${result.match}.`);
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

async function waitForEnter(promptText) {
  process.stdout.write(`${promptText}\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise((resolve) => rl.question("Press Enter here once the browser profile is ready. ", resolve));
  rl.close();
}

async function openBrowserContext(profileDir, headed, channel) {
  return chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    channel: channel || undefined,
    args: ["--disable-dev-shm-usage"],
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

async function runLoginFlow(groupUrl, profileDir, channel) {
  const context = await openBrowserContext(profileDir, true, channel);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(groupUrl, { waitUntil: "domcontentloaded" });
    await dismissCookieBanners(page);
    await waitForEnter(
      "A headed browser has been opened on the Linux box. Log into Facebook in that browser and verify the Yeh That Rocks group page loads cleanly.",
    );
  } finally {
    await context.close();
  }
}

async function runPostFlow({ article, groupUrl, profileDir, headed, dryRun, channel }) {
  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run", article }, null, 2));
    return { submitted: false, dryRun: true };
  }

  const keepBrowserOpen = shouldKeepBrowserOpen();
  const pauseBeforeSubmit = shouldPauseBeforeSubmit();
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
    const message = buildMessage(article.articleUrl);
    await page.evaluate((text) => navigator.clipboard.writeText(text), message);
    await page.keyboard.press("Control+v");
    console.log("[magazine-facebook-browser-post] Article URL inserted into composer.");
    await page.waitForTimeout(800);

    console.log("[magazine-facebook-browser-post] Waiting 5 seconds for Facebook to build the post preview.");
    await page.waitForTimeout(5000);

    console.log("[magazine-facebook-browser-post] Looking for Next button.");
    await clickNextSpan(page);
    console.log("[magazine-facebook-browser-post] Waiting 2 seconds for the second page to load.");
    await page.waitForTimeout(2000);

    if (pauseBeforeSubmit) {
      console.log("[magazine-facebook-browser-post] Advanced to page 2 and paused before submit.");
      if (keepBrowserOpen) {
        inspectionPrompt = "Dialog page 2 is open and submission is paused. Review the remote Chromium window, then press Enter here to close it without posting.";
      }
      return { submitted: false, pausedBeforeSubmit: true, advancedToPage2: true };
    }

    let submitted = false;

    try {
      console.log("[magazine-facebook-browser-post] Looking for Post button.");
      await clickPostButton(page);
      submitted = true;
    } catch {
      submitted = await submitWithKeyboard(page);
    }

    if (!submitted) {
      throw new Error("Could not submit Facebook post using button or keyboard shortcut");
    }

    // --pause: keep browser open after first button click so operator can inspect page 2.
    if (hasArg("--pause")) {
      console.log("[magazine-facebook-browser-post] PAUSED — browser stays open for 60 seconds so you can inspect page 2.");
      await page.waitForTimeout(60000);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    console.log("[magazine-facebook-browser-post] Waiting 10 seconds for Facebook to complete the post.");
    await page.waitForTimeout(10000);
    return { submitted: true };
  } catch (error) {
    pendingError = error;
    if (keepBrowserOpen) {
      const message = error && error.message ? error.message : String(error);
      inspectionPrompt = `Run failed: ${message}\nInspect the remote Chromium window, then press Enter here to close it.`;
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

async function main() {
  loadEnv();

  const loginMode = hasArg("--login");
  const dryRun = hasArg("--dry-run") || toBool(process.env.MAGAZINE_BROWSER_POST_DRY_RUN, false);
  const forceLatest = shouldForceLatestArticle();
  const headed = loginMode || !toBool(process.env.MAGAZINE_BROWSER_POST_HEADLESS, false);

  const appUrl = trimTrailingSlash(process.env.APP_URL || process.env.MAGAZINE_BROWSER_POST_APP_URL);
  if (!appUrl) {
    throw new Error("APP_URL or MAGAZINE_BROWSER_POST_APP_URL must be set");
  }

  const groupUrl = validateFacebookTargetUrl(
    String(process.env.MAGAZINE_BROWSER_POST_GROUP_URL || "").trim(),
  );
  const profileDir = path.resolve(
    process.env.MAGAZINE_BROWSER_POST_PROFILE_DIR || resolveHomePath(".local", "share", "yehthatrocks", "facebook-magazine-browser-profile"),
  );
  const statePath = path.resolve(
    process.env.MAGAZINE_BROWSER_POST_STATE_PATH || resolveHomePath(".local", "state", "yehthatrocks", "magazine-facebook-browser-state.json"),
  );
  const lockPath = path.resolve(
    process.env.MAGAZINE_BROWSER_POST_LOCK_PATH || resolveHomePath(".local", "state", "yehthatrocks", "magazine-facebook-browser.lock"),
  );
  const articleApiUrl = String(process.env.MAGAZINE_BROWSER_POST_ARTICLE_API_URL || "").trim();
  const browserChannel = String(process.env.MAGAZINE_BROWSER_POST_BROWSER_CHANNEL || "").trim();

  const releaseLock = acquireLock(lockPath);

  try {
    if (loginMode) {
      await runLoginFlow(groupUrl, profileDir, browserChannel);
      console.log("Facebook browser profile login flow completed.");
      return;
    }

    const state = readState(statePath);
    const article = await fetchLatestArticle(appUrl, articleApiUrl);
    const alreadyPosted = state.posted.some((entry) => String(entry.slug || "").trim() === article.slug);

    if (alreadyPosted && !forceLatest) {
      writeState(statePath, {
        ...state,
        lastCheckedAt: new Date().toISOString(),
        lastSeenSlug: article.slug,
      });
      console.log(`[magazine-facebook-browser-post] No new article to post. Latest slug is still ${article.slug}.`);
      return;
    }

    if (alreadyPosted && forceLatest) {
      console.log(`[magazine-facebook-browser-post] Force mode enabled. Continuing with already-posted slug ${article.slug}.`);
    }

    const result = await runPostFlow({
      article,
      groupUrl,
      profileDir,
      headed,
      dryRun,
      channel: browserChannel,
    });

    if (dryRun) {
      console.log(`[magazine-facebook-browser-post] Dry run would post ${article.slug} -> ${article.articleUrl}`);
      return;
    }

    if (result && result.submitted === false) {
      writeState(statePath, {
        ...state,
        lastCheckedAt: new Date().toISOString(),
        lastSeenSlug: article.slug,
      });
      console.log(`[magazine-facebook-browser-post] Inspection run completed for ${article.slug} without submitting a Facebook post.`);
      return;
    }

    const postedAt = new Date().toISOString();
    writeState(statePath, {
      posted: [
        ...state.posted,
        {
          slug: article.slug,
          articleUrl: article.articleUrl,
          postedAt,
          title: article.title,
        },
      ].slice(-1000),
      lastCheckedAt: postedAt,
      lastSeenSlug: article.slug,
    });

    console.log(`[magazine-facebook-browser-post] Posted ${article.slug} -> ${article.articleUrl}`);
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`[magazine-facebook-browser-post] ${message}`);
  process.exit(1);
});