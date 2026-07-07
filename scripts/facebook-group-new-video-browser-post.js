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
  const cwd = process.cwd();
  loadEnvFile(path.resolve(cwd, ".env"));
  // Also try the standard config location (used by systemd EnvironmentFile).
  loadEnvFile(path.resolve(os.homedir(), ".config", "yehthatrocks", "facebook-new-video-browser.env"));
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {
      posted: [],
      lastCheckedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      posted: Array.isArray(parsed.posted) ? parsed.posted : [],
      lastCheckedAt: typeof parsed.lastCheckedAt === "string" ? parsed.lastCheckedAt : null,
    };
  } catch {
    return {
      posted: [],
      lastCheckedAt: null,
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
      throw new Error(`Another new-video browser post run is already active: ${lockPath}`);
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
    throw new Error("NEW_VIDEO_BROWSER_POST_GROUP_URL must be set");
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`NEW_VIDEO_BROWSER_POST_GROUP_URL is not a valid URL: ${normalized}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "www.facebook.com" && hostname !== "facebook.com" && hostname !== "m.facebook.com") {
    throw new Error(
      `NEW_VIDEO_BROWSER_POST_GROUP_URL must point to a Facebook URL. Received: ${normalized}`,
    );
  }

  return normalized;
}

function buildVideoUrl(appUrl, videoId) {
  return `${trimTrailingSlash(appUrl)}/s/${encodeURIComponent(String(videoId || "").trim())}`;
}

function buildMessage(videoUrl, video) {
  const artist = String(video.artist || "Unknown artist").trim();
  const track = String(video.title || "Unknown track").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  return [
    `New on YehThatRocks: ${artist} - ${track}`,
    `Genre: ${genre}`,
    "",
    videoUrl,
    "",
    "What do you think of this one?",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Fetch a random video from the public newest-videos API
// ---------------------------------------------------------------------------

async function fetchRandomNewVideo(appUrl) {
  const apiUrl = `${trimTrailingSlash(appUrl)}/api/videos/newest?take=200`;
  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`New videos fetch failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const videos = Array.isArray(payload?.videos) ? payload.videos : [];

  if (videos.length === 0) {
    throw new Error("New videos API returned an empty list");
  }

  // Pick a random video from the pool.
  const pickIndex = Math.floor(Math.random() * videos.length);
  const video = videos[pickIndex];

  if (!video || typeof video.id !== "string" || !video.id.trim()) {
    throw new Error("Selected video payload did not include an id");
  }

  return {
    videoId: video.id.trim(),
    title: typeof video.title === "string" ? video.title.trim()
      : typeof video.parsedTrack === "string" ? video.parsedTrack.trim() : "",
    artist: typeof video.parsedArtist === "string" ? video.parsedArtist.trim()
      : typeof video.channelTitle === "string" ? video.channelTitle.trim() : "",
    genre: typeof video.genre === "string" ? video.genre.trim() : "",
    videoUrl: buildVideoUrl(appUrl, video.id),
    poolSize: videos.length,
  };
}

// ---------------------------------------------------------------------------
// Browser helpers (same patterns as magazine-facebook-browser-post.js)
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
      console.log(`[new-video-browser-post] Found composer opener via: ${sel}`);
      await el.click();
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
      console.log(`[new-video-browser-post] Clicked Next via ${result.match}.`);
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
      console.log(`[new-video-browser-post] Clicked Post via ${result.match}.`);
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

function shouldKeepBrowserOpen() {
  return hasArg("--keep-open") || toBool(process.env.NEW_VIDEO_BROWSER_POST_KEEP_OPEN, false);
}

function shouldPauseBeforeSubmit() {
  return hasArg("--pause-before-submit") || toBool(process.env.NEW_VIDEO_BROWSER_POST_PAUSE_BEFORE_SUBMIT, false);
}

function shouldForcePost() {
  return hasArg("--force") || toBool(process.env.NEW_VIDEO_BROWSER_POST_FORCE, false);
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

async function runPostFlow({ video, groupUrl, profileDir, headed, dryRun, channel }) {
  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run", video }, null, 2));
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
    await page.goto(groupUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    // Wait for the Facebook SPA to finish rendering the feed/composer area.
    // Fresh browser profiles need more time for Facebook to hydrate its UI.
    await page.waitForTimeout(5000);
    // Scroll down slightly to trigger lazy-loaded composer elements.
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(1000);
    await dismissCookieBanners(page);
    await page.waitForTimeout(1000);

    // Open the Create Post dialog — Facebook automatically focuses the textbox.
    await openComposer(page);
    // Give Facebook's JS a moment to settle focus on the textbox.
    await page.waitForTimeout(600);
    const message = buildMessage(video.videoUrl, video);
    await page.evaluate((text) => navigator.clipboard.writeText(text), message);
    await page.keyboard.press("Control+v");
    console.log("[new-video-browser-post] Video link inserted into composer.");
    await page.waitForTimeout(800);

    console.log("[new-video-browser-post] Waiting 5 seconds for Facebook to build the post preview.");
    await page.waitForTimeout(5000);

    // Facebook Pages show the Post button directly after the link preview loads
    // (no "Next" step). Facebook Groups have a two-step "Next" → "Post" flow.
    // Try Post-first; if it's not visible, fall back to the Group flow.
    let postButtonFound = false;
    try {
      console.log("[new-video-browser-post] Looking for Post button (Page flow).");
      await clickPostButton(page);
      postButtonFound = true;
    } catch {
      console.log("[new-video-browser-post] Post button not visible yet — trying Group flow via Next.");
    }

    if (!postButtonFound) {
      console.log("[new-video-browser-post] Looking for Next button (Group flow).");
      await clickNextSpan(page);
      console.log("[new-video-browser-post] Waiting 2 seconds for the second page to load.");
      await page.waitForTimeout(2000);
    }

    if (pauseBeforeSubmit) {
      console.log("[new-video-browser-post] Advanced to page 2 and paused before submit.");
      if (keepBrowserOpen) {
        inspectionPrompt = "Dialog page 2 is open and submission is paused. Review the remote Chromium window, then press Enter here to close it without posting.";
      }
      return { submitted: false, pausedBeforeSubmit: true, advancedToPage2: true };
    }

    let submitted = false;

    try {
      console.log("[new-video-browser-post] Looking for Post button.");
      await clickPostButton(page);
      submitted = true;
    } catch {
      submitted = await submitWithKeyboard(page);
    }

    if (!submitted) {
      throw new Error("Could not submit Facebook post using button or keyboard shortcut");
    }

    console.log("[new-video-browser-post] Post submitted. Waiting an additional 15 seconds before shutdown.");
    await page.waitForTimeout(15000);

    if (hasArg("--pause")) {
      console.log("[new-video-browser-post] PAUSED — browser stays open for 60 seconds so you can inspect page 2.");
      await page.waitForTimeout(60000);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    console.log("[new-video-browser-post] Waiting 10 seconds for Facebook to complete the post.");
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const loginMode = hasArg("--login");
  const dryRun = hasArg("--dry-run") || toBool(process.env.NEW_VIDEO_BROWSER_POST_DRY_RUN, false);
  const forcePost = shouldForcePost();
  const headed = loginMode || !toBool(process.env.NEW_VIDEO_BROWSER_POST_HEADLESS, false);

  const appUrl = trimTrailingSlash(process.env.APP_URL || process.env.NEW_VIDEO_BROWSER_POST_APP_URL);
  if (!appUrl) {
    throw new Error("APP_URL or NEW_VIDEO_BROWSER_POST_APP_URL must be set");
  }

  const groupUrl = validateFacebookTargetUrl(
    String(process.env.NEW_VIDEO_BROWSER_POST_GROUP_URL || "").trim(),
  );
  const profileDir = path.resolve(
    process.env.NEW_VIDEO_BROWSER_POST_PROFILE_DIR || resolveHomePath(".local", "share", "yehthatrocks", "facebook-new-video-browser-profile"),
  );
  const statePath = path.resolve(
    process.env.NEW_VIDEO_BROWSER_POST_STATE_PATH || resolveHomePath(".local", "state", "yehthatrocks", "new-video-browser-state.json"),
  );
  const lockPath = path.resolve(
    process.env.NEW_VIDEO_BROWSER_POST_LOCK_PATH || resolveHomePath(".local", "state", "yehthatrocks", "new-video-browser.lock"),
  );
  const browserChannel = String(process.env.NEW_VIDEO_BROWSER_POST_BROWSER_CHANNEL || "").trim();

  const releaseLock = acquireLock(lockPath);

  try {
    if (loginMode) {
      await runLoginFlow(groupUrl, profileDir, browserChannel);
      console.log("Facebook browser profile login flow completed.");
      return;
    }

    const state = readState(statePath);
    const video = await fetchRandomNewVideo(appUrl);
    const alreadyPosted = state.posted.some((entry) => String(entry.videoId || "").trim() === video.videoId);

    if (alreadyPosted && !forcePost) {
      writeState(statePath, {
        ...state,
        lastCheckedAt: new Date().toISOString(),
      });
      console.log(`[new-video-browser-post] Video ${video.videoId} already posted. Skipping.`);
      return;
    }

    if (alreadyPosted && forcePost) {
      console.log(`[new-video-browser-post] Force mode enabled. Continuing with already-posted video ${video.videoId}.`);
    }

    const result = await runPostFlow({
      video,
      groupUrl,
      profileDir,
      headed,
      dryRun,
      channel: browserChannel,
    });

    if (dryRun) {
      console.log(`[new-video-browser-post] Dry run would post ${video.videoId} -> ${video.videoUrl}`);
      return;
    }

    if (result && result.submitted === false) {
      writeState(statePath, {
        ...state,
        lastCheckedAt: new Date().toISOString(),
      });
      console.log(`[new-video-browser-post] Inspection run completed for ${video.videoId} without submitting a Facebook post.`);
      return;
    }

    const postedAt = new Date().toISOString();
    writeState(statePath, {
      posted: [
        ...state.posted,
        {
          videoId: video.videoId,
          videoUrl: video.videoUrl,
          postedAt,
          title: video.title,
          artist: video.artist,
        },
      ].slice(-1000),
      lastCheckedAt: postedAt,
    });

    console.log(`[new-video-browser-post] Posted ${video.videoId} -> ${video.videoUrl}`);
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`[new-video-browser-post] ${message}`);
  process.exit(1);
});
