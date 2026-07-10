#!/usr/bin/env node

/**
 * Pinterest auto-pin script.
 *
 * Creates Pins for music videos on genre-specific Pinterest boards using
 * Puppeteer browser automation. Uses Pinterest's "create pin" share URL
 * flow for reliability — the form is pre-filled, we just select the board
 * and click Save.
 *
 * Usage:
 *   node scripts/pinterest-auto-pin.js --dry-run
 *   node scripts/pinterest-auto-pin.js --force
 *   node scripts/pinterest-auto-pin.js --list-boards
 *
 * Prerequisites:
 *   npm install puppeteer
 *
 * Required env (create a Pinterest business account at pinterest.com):
 *   PINTEREST_EMAIL — Pinterest login email
 *   PINTEREST_PASSWORD — Pinterest login password
 *
 * Optional env:
 *   PINTEREST_MAX_PINS_PER_RUN — max pins per execution (default: 5)
 *   PINTEREST_HEADLESS — set to "0" to show the browser (default: "1")
 *   PINTEREST_CHROMIUM_PATH — custom Chromium executable path
 *   PINTEREST_AUTOPIN_STATE_PATH — state file path (default: logs/pinterest-autopin-state.json)
 *
 * Phase 2.3 — Pinterest auto-pin distribution (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

// Load env before PrismaClient
try { require("dotenv").config({ path: path.resolve(process.cwd(), "apps/web/.env.local") }); } catch {}
try { require("dotenv").config(); } catch {}

const {
  loadEnv,
  toPositiveInt,
  ensureDirFor,
  readState,
  writeState,
  getTopPlayableCandidates,
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Pinterest board definitions (genre → board name)
// ---------------------------------------------------------------------------

const GENRE_BOARDS = [
  { keywords: ["progressive metal", "prog metal", "prog rock"], board: "Progressive Metal & Rock" },
  { keywords: ["death metal", "deathcore", "melodic death"], board: "Death Metal" },
  { keywords: ["black metal", "blackened"], board: "Black Metal" },
  { keywords: ["doom metal", "doom", "sludge", "stoner"], board: "Doom & Stoner Metal" },
  { keywords: ["thrash metal", "thrash"], board: "Thrash Metal" },
  { keywords: ["power metal", "power"], board: "Power Metal" },
  { keywords: ["symphonic metal", "symphonic"], board: "Symphonic Metal" },
  { keywords: ["metalcore", "metal core"], board: "Metalcore" },
  { keywords: ["nu metal", "nu-metal", "numetal"], board: "Nu Metal" },
  { keywords: ["gothic metal", "gothic"], board: "Gothic Metal" },
  { keywords: ["folk metal", "folk", "viking"], board: "Folk & Viking Metal" },
  { keywords: ["industrial"], board: "Industrial Metal" },
  { keywords: ["grindcore", "deathgrind"], board: "Grindcore" },
  { keywords: ["classic rock", "classic"], board: "Classic Rock" },
  { keywords: ["hard rock", "hardrock"], board: "Hard Rock" },
  { keywords: ["alternative", "alt rock"], board: "Alternative Rock" },
  { keywords: ["punk", "punk rock", "hardcore"], board: "Punk & Hardcore" },
  { keywords: ["indie"], board: "Indie Rock" },
  { keywords: ["grunge", "post-grunge"], board: "Grunge" },
  { keywords: ["psychedelic", "psych"], board: "Psychedelic Rock" },
  { keywords: ["blues"], board: "Blues Rock" },
  { keywords: ["rock"], board: "Rock Music Videos" },
  { keywords: ["metal", "heavy metal"], board: "Heavy Metal" },
];

const DEFAULT_BOARD = "Rock & Metal Discoveries";

function resolveBoardForGenre(genre) {
  const normalized = String(genre || "").toLowerCase().trim();
  if (!normalized) return DEFAULT_BOARD;

  for (const entry of GENRE_BOARDS) {
    for (const kw of entry.keywords) {
      if (normalized.includes(kw) || kw.includes(normalized)) {
        return entry.board;
      }
    }
  }
  return DEFAULT_BOARD;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://yehthatrocks.com").replace(/\/$/, "");
const APP_URL = (process.env.APP_URL || "").trim().replace(/\/$/, "") || SITE_ORIGIN;

function buildShareUrl(videoId) {
  const base = `${APP_URL}/s/${encodeURIComponent(videoId)}`;
  const utm = new URLSearchParams({
    utm_source: "pinterest",
    utm_medium: "social",
    utm_campaign: "autopin",
  });
  return `${base}?${utm.toString()}`;
}

function buildPinDescription(video) {
  const artist = String(video.artist || "Unknown artist").trim();
  const track = String(video.title || "Unknown track").trim();
  const genre = String(video.genre || "Rock / Metal").trim();
  return `${artist} — ${track} [${genre}]\n\nDiscover more rock and metal at yehthatrocks.com`;
}

function listBoards() {
  const boards = new Set();
  for (const entry of GENRE_BOARDS) boards.add(entry.board);
  boards.add(DEFAULT_BOARD);

  console.log("Pinterest boards & sample genres:");
  const sorted = Array.from(boards).sort();
  for (const board of sorted) {
    const genres = GENRE_BOARDS.filter((e) => e.board === board).flatMap((e) => e.keywords).slice(0, 3);
    console.log(`  📌 ${board.padEnd(32)} ← ${genres.join(", ")}`);
  }
  console.log(`\nTotal boards: ${sorted.length}`);
}

// ---------------------------------------------------------------------------
// Pinterest browser automation
// ---------------------------------------------------------------------------

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log into Pinterest. Returns when the home feed is visible.
 */
async function loginToPinterest(page, email, password) {
  console.log("[pinterest] Navigating to login page...");
  await page.goto("https://www.pinterest.com/login/", { waitUntil: "networkidle2", timeout: 30000 });

  // Pinterest login form
  const emailSelector = 'input[name="id"], input[type="email"], #email';
  const passwordSelector = 'input[name="password"], input[type="password"], #password';

  try {
    await page.waitForSelector(emailSelector, { timeout: 10000 });
  } catch {
    // Pinterest might have a different login flow — try the /login redirect
    console.log("[pinterest] Login form not found, trying alternative...");
    await page.goto("https://www.pinterest.com/login/?next=%2F", { waitUntil: "networkidle2", timeout: 30000 });
  }

  console.log("[pinterest] Filling credentials...");
  await page.type(emailSelector, email, { delay: 50 });
  await page.type(passwordSelector, password, { delay: 50 });

  // Click the login button
  const submitSelector = 'button[type="submit"], div[data-test-id="registerFormSubmitButton"], button:has-text("Log in")';
  await page.click(submitSelector);

  // Wait for login to complete
  await sleep(4000);

  // Check if we're on the home page
  const currentUrl = page.url();
  if (currentUrl.includes("login")) {
    // Might need to handle 2FA or captcha
    console.log("[pinterest] ⚠️  Still on login page — check for CAPTCHA or 2FA");
    await page.screenshot({ path: path.resolve(process.cwd(), "logs/pinterest-login-screenshot.png") });
    console.log("[pinterest] Screenshot saved to logs/pinterest-login-screenshot.png");
    return false;
  }

  console.log("[pinterest] ✅ Logged in successfully");
  return true;
}

/**
 * Create a pin using Pinterest's share/create URL.
 * The share URL pre-fills the create form with url, media, and description.
 * We just need to select the board and click Save.
 */
async function createPin(page, video, boardName) {
  const videoId = String(video.videoId || "").trim();
  if (!videoId) throw new Error("Missing videoId");

  const thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const shareUrl = buildShareUrl(videoId);
  const description = buildPinDescription(video);

  // Build Pinterest create URL with pre-filled fields
  const pinCreateUrl = new URL("https://www.pinterest.com/pin/create/button/");
  pinCreateUrl.searchParams.set("url", shareUrl);
  pinCreateUrl.searchParams.set("media", thumbnailUrl);
  pinCreateUrl.searchParams.set("description", description);

  console.log(`[pinterest] Creating pin: ${video.artist} — ${video.title}`);
  await page.goto(pinCreateUrl.toString(), { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(2000);

  // The create form should be visible with the image pre-loaded.
  // Take a screenshot for debugging
  const debugShot = path.resolve(process.cwd(), `logs/pinterest-create-${videoId}.png`);
  await page.screenshot({ path: debugShot });

  // Try to select the board from the board picker dropdown
  try {
    // Click the board selector (might be a dropdown or button)
    const boardSelectors = [
      'div[data-test-id="board-dropdown"]',
      'div[data-test-id="board-selector"]',
      'button:has-text("Save to")',
      'div[role="listbox"]',
      'div.board-picker',
    ];

    let boardPickerClicked = false;
    for (const sel of boardSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 3000 });
        await page.click(sel);
        boardPickerClicked = true;
        console.log(`[pinterest] Clicked board picker: ${sel}`);
        await sleep(1000);
        break;
      } catch {
        continue;
      }
    }

    if (boardPickerClicked) {
      // Try to find and click the target board
      const boardItemSelectors = [
        `div[role="option"]:has-text("${boardName}")`,
        `div:has-text("${boardName}")`,
        `[data-test-id="board-row-${boardName.toLowerCase().replace(/[^a-z0-9]/g, "-")}"]`,
      ];

      for (const sel of boardItemSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 3000 });
          await page.click(sel);
          console.log(`[pinterest] Selected board: ${boardName}`);
          await sleep(1000);
          break;
        } catch {
          continue;
        }
      }
    } else {
      console.log(`[pinterest] ⚠️  Could not find board picker. The pin will go to your default board.`);
    }
  } catch (err) {
    console.log(`[pinterest] ⚠️  Board selection failed: ${err.message}. Using default board.`);
  }

  // Click the Save/Publish button
  try {
    const saveSelectors = [
      'button[data-test-id="board-dropdown-save-button"]',
      'button[data-test-id="pin-builder-save-button"]',
      'button:has-text("Save")',
      'button[type="submit"]',
      'div[data-test-id="create-pin-bottom-save"] button',
    ];

    let saved = false;
    for (const sel of saveSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        await page.click(sel);
        console.log(`[pinterest] ✅ Pin saved: ${video.artist} — ${video.title}`);
        saved = true;
        break;
      } catch {
        continue;
      }
    }

    if (!saved) {
      console.log(`[pinterest] ⚠️  Could not find Save button. Screenshot saved for debugging.`);
      return false;
    }
  } catch (err) {
    console.log(`[pinterest] ⚠️  Save click failed: ${err.message}`);
    return false;
  }

  // Wait for save confirmation
  await sleep(2000);
  return true;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const forceRun = args.includes("--force");
  const listBoardsFlag = args.includes("--list-boards");

  if (listBoardsFlag) {
    listBoards();
    return;
  }

  // ── Config ─────────────────────────────────────────────────────────────
  const maxPins = toPositiveInt(process.env.PINTEREST_MAX_PINS_PER_RUN || "5", 5);
  const headless = String(process.env.PINTEREST_HEADLESS || "1") !== "0";
  const chromiumPath = process.env.PINTEREST_CHROMIUM_PATH || undefined;
  const email = (process.env.PINTEREST_EMAIL || "").trim();
  const password = (process.env.PINTEREST_PASSWORD || "").trim();
  const statePath = path.resolve(
    process.cwd(),
    process.env.PINTEREST_AUTOPIN_STATE_PATH || "logs/pinterest-autopin-state.json",
  );

  if (!dryRun && !email) throw new Error("PINTEREST_EMAIL is required for live posting.");
  if (!dryRun && !password) throw new Error("PINTEREST_PASSWORD is required for live posting.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── State and deduplication ────────────────────────────────────────────
  const now = new Date();
  const state = readState(statePath);
  const pinnedIds = new Set(
    (Array.isArray(state.pins) ? state.pins : []).map((p) => String(p.videoId || "").trim()).filter(Boolean),
  );

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const pinsToday = (Array.isArray(state.pins) ? state.pins : []).filter((p) => {
    const ts = new Date(p.pinnedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (!forceRun && pinsToday >= Math.max(maxPins, 10)) {
    console.log(`[pinterest] Skipped: daily pin cap reached (${pinsToday}).`);
    return;
  }

  // ── Candidate selection ────────────────────────────────────────────────
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  let candidates;
  try {
    const pool = await getTopPlayableCandidates(prisma, 300);
    const fresh = pool.filter((v) => !pinnedIds.has(v.videoId));
    candidates = fresh.length > 0 ? fresh : pool;

    if (candidates.length === 0) {
      console.log("[pinterest] No candidates available.");
      return;
    }
  } finally {
    await prisma.$disconnect();
  }

  // Take the top N candidates by favourited count
  const selected = candidates.slice(0, Math.min(maxPins, candidates.length));

  // ── Dry-run ────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log(`[pinterest] Dry run — would pin ${selected.length} videos:`);
    for (const video of selected) {
      const board = resolveBoardForGenre(video.genre);
      console.log(`  📌 [${board}] ${video.artist} — ${video.title}  →  ${buildShareUrl(video.videoId)}`);
    }
    return;
  }

  // ── Browser automation ─────────────────────────────────────────────────
  console.log("[pinterest] Launching browser...");
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: headless ? "new" : false,
    executablePath: chromiumPath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );

  try {
    // Login
    const loggedIn = await loginToPinterest(page, email, password);
    if (!loggedIn) {
      console.log("[pinterest] ❌ Login failed. Check credentials or CAPTCHA.");
      await browser.close();
      return;
    }

    // Create pins
    const newPins = [];
    for (const video of selected) {
      const board = resolveBoardForGenre(video.genre);
      console.log(`[pinterest] Pinning to "${board}": ${video.artist} — ${video.title}`);

      try {
        const success = await createPin(page, video, board);
        if (success) {
          newPins.push({
            pinnedAt: new Date().toISOString(),
            videoId: video.videoId,
            artist: video.artist,
            title: video.title,
            genre: video.genre,
            board,
          });
        }
        // Small delay between pins to avoid rate limiting
        await sleep(3000);
      } catch (err) {
        console.log(`[pinterest] ❌ Failed to pin ${video.videoId}: ${err.message}`);
      }
    }

    // Save state
    const nextState = {
      lastRunAt: now.toISOString(),
      pins: [...(Array.isArray(state.pins) ? state.pins : []), ...newPins].slice(-2000),
    };
    writeState(statePath, nextState);

    console.log(`[pinterest] Done. Pinned ${newPins.length}/${selected.length} videos.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[pinterest] Failed:", error?.message || error);
  process.exit(1);
});
