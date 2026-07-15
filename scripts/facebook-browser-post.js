#!/usr/bin/env node
"use strict";

// ===========================================================================
// facebook-browser-post.js — unified Facebook group browser posting script
//
// Supports 6 post modes designed to drive organic engagement:
//   magazine   — latest magazine article link
//   spotlight  — single video with discussion question
//   versus     — two videos head-to-head
//   discussion — text-only discussion prompt (no link)
//   roundup    — top N tracks this week
//   trivia     — guess the artist/track from clues
//
// Usage:
//   node scripts/facebook-browser-post.js --mode <name> [--dry-run] [--login] [--keep-open] ...
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  hasArg,
  toBool,
  ensureDirFor,
  loadEnvFile,
  resolveHomePath,
  trimTrailingSlash,
  validateFacebookTargetUrl,
  acquireLock,
  readState,
  writeState,
  runLoginFlow,
  runBrowserPostFlow,
} = require("./lib/facebook-browser-utils");

const {
  loadEnv,
  toPositiveInt,
  getTopPlayableCandidates,
  pickWeightedCandidate,
  getVersusCandidates,
  getRoundupCandidates,
  fetchSpotlightCandidate,
  fetchVersusCandidates,
  fetchRoundupCandidates,
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

const VALID_MODES = new Set([
  "magazine",
  "spotlight",
  "versus",
  "discussion",
  "roundup",
  "trivia",
]);

function parseMode() {
  const modeIdx = process.argv.indexOf("--mode");
  if (modeIdx === -1) {
    // Backward compat: if no --mode flag, default to magazine
    return "magazine";
  }

  const raw = String(process.argv[modeIdx + 1] || "").trim().toLowerCase();
  if (!VALID_MODES.has(raw)) {
    const valid = Array.from(VALID_MODES).join(", ");
    throw new Error(`Unknown mode "${raw}". Valid modes: ${valid}`);
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Shared configuration loader
// ---------------------------------------------------------------------------

function loadConfig() {
  // Load env from .env.local and .env
  loadEnv();

  // Also try the magazine-specific env file path for legacy compat.
  loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));

  // Load the Linux config file (systemd EnvironmentFile equivalent).
  loadEnvFile(path.join(resolveHomePath(".config", "yehthatrocks"), "facebook-browser.env"));

  const mode = parseMode();
  const loginMode = hasArg("--login");
  const dryRun = hasArg("--dry-run") || toBool(process.env.FB_BROWSER_POST_DRY_RUN, false);
  const headed =
    loginMode ||
    hasArg("--headed") ||
    !toBool(process.env.FB_BROWSER_POST_HEADLESS, true);
  const keepOpen =
    hasArg("--keep-open") || toBool(process.env.FB_BROWSER_POST_KEEP_OPEN, false);
  const pauseBeforeSubmit =
    hasArg("--pause-before-submit") ||
    toBool(process.env.FB_BROWSER_POST_PAUSE_BEFORE_SUBMIT, false);
  const forceLatest =
    hasArg("--force-latest") || toBool(process.env.FB_BROWSER_POST_FORCE_LATEST, false);

  // Group URL: try new env var first, fall back to legacy magazine var.
  const rawGroupUrl =
    process.env.FB_BROWSER_POST_GROUP_URL ||
    process.env.MAGAZINE_BROWSER_POST_GROUP_URL ||
    "";
  const groupUrl = validateFacebookTargetUrl(rawGroupUrl);

  // App URL.
  const appUrl = trimTrailingSlash(
    process.env.FB_BROWSER_POST_APP_URL ||
    process.env.APP_URL ||
    process.env.MAGAZINE_BROWSER_POST_APP_URL ||
    "",
  );

  if (!appUrl) {
    throw new Error("APP_URL or FB_BROWSER_POST_APP_URL must be set");
  }

  // Profile dir.
  const profileDir = path.resolve(
    process.env.FB_BROWSER_POST_PROFILE_DIR ||
    process.env.MAGAZINE_BROWSER_POST_PROFILE_DIR ||
    resolveHomePath(".local", "share", "yehthatrocks", "facebook-browser-profile"),
  );

  // State dir — each mode gets its own state file here.
  const stateDirRaw =
    process.env.FB_BROWSER_POST_STATE_DIR ||
    // Fall back to directory of the legacy magazine state path.
    (process.env.MAGAZINE_BROWSER_POST_STATE_PATH
      ? path.dirname(process.env.MAGAZINE_BROWSER_POST_STATE_PATH)
      : null) ||
    resolveHomePath(".local", "state", "yehthatrocks");
  const stateDir = path.resolve(stateDirRaw);
  // Per-mode state file.
  const statePath = path.join(stateDir, `${mode}-facebook-browser-state.json`);

  // Lock path.
  const lockPath = path.resolve(
    process.env.FB_BROWSER_POST_LOCK_PATH ||
    process.env.MAGAZINE_BROWSER_POST_LOCK_PATH ||
    resolveHomePath(".local", "state", "yehthatrocks", "facebook-browser.lock"),
  );

  // Browser channel.
  const browserChannel = String(
    process.env.FB_BROWSER_POST_BROWSER_CHANNEL ||
    process.env.MAGAZINE_BROWSER_POST_BROWSER_CHANNEL ||
    "",
  ).trim();

  return {
    mode,
    loginMode,
    dryRun,
    headed,
    keepOpen,
    pauseBeforeSubmit,
    forceLatest,
    groupUrl,
    appUrl,
    profileDir,
    stateDir,
    statePath,
    lockPath,
    browserChannel,
  };
}

// ===========================================================================
// CONTENT BUILDERS — one per mode
// ===========================================================================

// ---------------------------------------------------------------------------
// Magazine mode
// ---------------------------------------------------------------------------

async function fetchLatestArticle(appUrl, apiUrlOverride) {
  const apiUrl = trimTrailingSlash(apiUrlOverride) ||
    `${trimTrailingSlash(appUrl)}/api/magazine/latest?limit=1`;

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
    articleUrl: `${trimTrailingSlash(appUrl)}/magazine/${encodeURIComponent(article.slug.trim())}`,
  };
}

async function buildMagazinePost({ appUrl, forceLatest, state }) {
  const articleApiUrl = String(
    process.env.FB_BROWSER_POST_MAGAZINE_ARTICLE_API_URL ||
    process.env.MAGAZINE_BROWSER_POST_ARTICLE_API_URL ||
    "",
  ).trim();

  const article = await fetchLatestArticle(appUrl, articleApiUrl);
  const alreadyPosted = (state.posted || []).some(
    (entry) => String(entry.slug || "").trim() === article.slug,
  );

  if (alreadyPosted && !forceLatest) {
    return { skip: true, reason: `No new article. Latest slug is still ${article.slug}.`, slug: article.slug };
  }

  if (alreadyPosted && forceLatest) {
    console.log(`[facebook-browser-post:magazine] Force mode enabled. Re-posting slug ${article.slug}.`);
  }

  const prefix = String(
    process.env.FB_BROWSER_POST_MAGAZINE_MESSAGE_PREFIX ||
    process.env.MAGAZINE_BROWSER_POST_MESSAGE_PREFIX ||
    "",
  ).trim();

  const message = prefix
    ? `${prefix}\n\n${article.articleUrl}`
    : article.articleUrl;

  return {
    message,
    dedupeKey: article.slug,
    meta: { slug: article.slug, title: article.title, articleUrl: article.articleUrl },
  };
}

// ---------------------------------------------------------------------------
// Spotlight mode
// ---------------------------------------------------------------------------

async function buildSpotlightPost({ appUrl, state }) {
  const hasDB = !!process.env.DATABASE_URL;
  const apiUrl = String(process.env.FB_BROWSER_API_URL || appUrl || "").trim();
  const apiSecret = String(process.env.FB_BROWSER_API_SECRET || "").trim();

  if (!hasDB && !apiSecret) {
    throw new Error("DATABASE_URL or FB_BROWSER_API_SECRET is required for spotlight mode");
  }

  const dedupeWindowDays = toPositiveInt(
    process.env.FB_BROWSER_POST_SPOTLIGHT_DEDUPE_DAYS || "60",
    60,
  );
  const now = new Date();
  const dedupeCutoff = new Date(
    now.getTime() - dedupeWindowDays * 24 * 60 * 60 * 1000,
  ).getTime();

  const recentlyPosted = new Set(
    (state.posted || [])
      .filter((entry) => {
        const ts = new Date(entry.postedAt).getTime();
        return Number.isFinite(ts) && ts >= dedupeCutoff;
      })
      .map((entry) => String(entry.videoId || "").trim())
      .filter(Boolean),
  );

  let selected;

  if (hasDB) {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const poolSize = toPositiveInt(
        process.env.FB_BROWSER_POST_SPOTLIGHT_POOL_SIZE || "600",
        600,
      );
      const pool = await getTopPlayableCandidates(prisma, poolSize);
      const filtered = pool.filter((v) => !recentlyPosted.has(v.videoId));
      const candidates = filtered.length > 0 ? filtered : pool;

      if (candidates.length === 0) {
        return { skip: true, reason: "No playable candidates available." };
      }

      selected = pickWeightedCandidate(candidates);
    } finally {
      await prisma.$disconnect();
    }
  } else {
    // HTTP API fallback — fetch up to 10 times for a non-recent candidate.
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = await fetchSpotlightCandidate(apiUrl, apiSecret);
      if (candidate && !recentlyPosted.has(candidate.videoId)) {
        selected = candidate;
        break;
      }
    }
  }

  if (!selected) {
    return { skip: true, reason: "No candidate selected." };
  }

  const shareLink = `${appUrl}/s/${encodeURIComponent(selected.videoId)}`;
  const prefix = String(
    process.env.FB_BROWSER_POST_SPOTLIGHT_MESSAGE_PREFIX || "🎸 Track Spotlight 🎸",
  ).trim();

  const message = [
    prefix,
    "",
    `${selected.artist} — ${selected.title}`,
    `Genre: ${selected.genre}`,
    "",
    shareLink,
    "",
    "What do you think of this one? Drop your thoughts below! 👇",
  ].join("\n");

  return {
    message,
    dedupeKey: selected.videoId,
    meta: { videoId: selected.videoId, artist: selected.artist, title: selected.title, link: shareLink },
  };
}

// ---------------------------------------------------------------------------
// Versus mode
// ---------------------------------------------------------------------------

async function buildVersusPost({ appUrl, state }) {
  const hasDB = !!process.env.DATABASE_URL;
  const apiUrl = String(process.env.FB_BROWSER_API_URL || appUrl || "").trim();
  const apiSecret = String(process.env.FB_BROWSER_API_SECRET || "").trim();

  if (!hasDB && !apiSecret) {
    throw new Error("DATABASE_URL or FB_BROWSER_API_SECRET is required for versus mode");
  }

  const dedupeWindowDays = toPositiveInt(
    process.env.FB_BROWSER_POST_VERSUS_DEDUPE_DAYS || "90",
    90,
  );
  const now = new Date();
  const dedupeCutoff = new Date(
    now.getTime() - dedupeWindowDays * 24 * 60 * 60 * 1000,
  ).getTime();

  const recentlyPosted = new Set(
    (state.posted || [])
      .filter((entry) => {
        const ts = new Date(entry.postedAt).getTime();
        return Number.isFinite(ts) && ts >= dedupeCutoff;
      })
      .map((entry) => String(entry.videoIdA || entry.videoId || "").trim())
      .filter(Boolean),
  );

  // Try up to 10 times to find a pair that hasn't been used recently.
  let pair = null;

  if (hasDB) {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const poolSize = toPositiveInt(
        process.env.FB_BROWSER_POST_VERSUS_POOL_SIZE || "600",
        600,
      );
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = await getVersusCandidates(prisma, poolSize);
        if (!candidate) continue;

        const key = `${candidate.candidateA.videoId}|${candidate.candidateB.videoId}`;
        const reverseKey = `${candidate.candidateB.videoId}|${candidate.candidateA.videoId}`;

        if (
          !recentlyPosted.has(candidate.candidateA.videoId) &&
          !recentlyPosted.has(candidate.candidateB.videoId) &&
          !(state.posted || []).some(
            (e) => String(e.dedupeKey || "") === key || String(e.dedupeKey || "") === reverseKey,
          )
        ) {
          pair = candidate;
          break;
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  } else {
    // HTTP API fallback.
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = await fetchVersusCandidates(apiUrl, apiSecret);
      if (!candidate) continue;

      const key = `${candidate.candidateA.videoId}|${candidate.candidateB.videoId}`;
      const reverseKey = `${candidate.candidateB.videoId}|${candidate.candidateA.videoId}`;

      if (
        !recentlyPosted.has(candidate.candidateA.videoId) &&
        !recentlyPosted.has(candidate.candidateB.videoId) &&
        !(state.posted || []).some(
          (e) => String(e.dedupeKey || "") === key || String(e.dedupeKey || "") === reverseKey,
        )
      ) {
        pair = candidate;
        break;
      }
    }
  }

  if (!pair) {
    return { skip: true, reason: "Could not find a fresh versus pair after 10 attempts." };
  }

  const { candidateA, candidateB } = pair;
  const linkA = `${appUrl}/s/${encodeURIComponent(candidateA.videoId)}`;
  const linkB = `${appUrl}/s/${encodeURIComponent(candidateB.videoId)}`;

  const prefix = String(
    process.env.FB_BROWSER_POST_VERSUS_MESSAGE_PREFIX || "⚔️ Track Battle! ⚔️",
  ).trim();

  const message = [
    prefix,
    "",
    `🅰️  ${candidateA.artist} — ${candidateA.title}`,
    `    ${linkA}`,
    "",
    `🅱️  ${candidateB.artist} — ${candidateB.title}`,
    `    ${linkB}`,
    "",
    "Which one takes it? Drop your vote in the comments! 👇",
  ].join("\n");

  const dedupeKey = `${candidateA.videoId}|${candidateB.videoId}`;

  return {
    message,
    dedupeKey,
    meta: {
      videoIdA: candidateA.videoId, artistA: candidateA.artist, titleA: candidateA.title, linkA,
      videoIdB: candidateB.videoId, artistB: candidateB.artist, titleB: candidateB.title, linkB,
    },
  };
}

// ---------------------------------------------------------------------------
// Discussion mode (text-only, no DB needed)
// ---------------------------------------------------------------------------

function loadDiscussionPrompts() {
  const promptsPath = path.resolve(__dirname, "data", "discussion-prompts.json");
  if (!fs.existsSync(promptsPath)) {
    throw new Error(`Discussion prompts file not found: ${promptsPath}`);
  }

  const raw = fs.readFileSync(promptsPath, "utf8");
  const prompts = JSON.parse(raw);
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error("Discussion prompts file is empty or invalid");
  }

  return prompts;
}

function buildDiscussionPost({ state }) {
  const prompts = loadDiscussionPrompts();
  const dedupeWindowDays = toPositiveInt(
    process.env.FB_BROWSER_POST_DISCUSSION_DEDUPE_DAYS || "14",
    14,
  );

  const now = new Date();
  const dedupeCutoff = new Date(
    now.getTime() - dedupeWindowDays * 24 * 60 * 60 * 1000,
  ).getTime();

  const recentlyUsed = new Set(
    (state.posted || [])
      .filter((entry) => {
        const ts = new Date(entry.postedAt).getTime();
        return Number.isFinite(ts) && ts >= dedupeCutoff;
      })
      .map((entry) => String(entry.promptId || "").trim())
      .filter(Boolean),
  );

  // Prefer unused prompts; fall back to any if all are exhausted.
  const available = prompts.filter((p) => !recentlyUsed.has(p.id));
  const pool = available.length > 0 ? available : prompts;
  const selected = pool[Math.floor(Math.random() * pool.length)];

  const prefix = String(
    process.env.FB_BROWSER_POST_DISCUSSION_MESSAGE_PREFIX || "💬 Discussion Time",
  ).trim();

  const message = [
    prefix,
    "",
    selected.text,
    "",
    "Sound off in the comments! 🤘",
  ].join("\n");

  return {
    message,
    dedupeKey: selected.id,
    meta: { promptId: selected.id, text: selected.text, tags: selected.tags },
  };
}

// ---------------------------------------------------------------------------
// Roundup mode
// ---------------------------------------------------------------------------

async function buildRoundupPost({ appUrl, state }) {
  const hasDB = !!process.env.DATABASE_URL;
  const apiUrl = String(process.env.FB_BROWSER_API_URL || appUrl || "").trim();
  const apiSecret = String(process.env.FB_BROWSER_API_SECRET || "").trim();

  if (!hasDB && !apiSecret) {
    throw new Error("DATABASE_URL or FB_BROWSER_API_SECRET is required for roundup mode");
  }

  const count = toPositiveInt(
    process.env.FB_BROWSER_POST_ROUNDUP_COUNT || "5",
    5,
  );

  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Only one roundup per day.
  const alreadyPostedToday = (state.posted || []).some(
    (entry) => String(entry.dateKey || "").trim() === dateKey,
  );

  if (alreadyPostedToday) {
    return { skip: true, reason: `Roundup already posted for ${dateKey}.` };
  }

  let tracks;

  if (hasDB) {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    try {
      tracks = await getRoundupCandidates(prisma, count);
    } finally {
      await prisma.$disconnect();
    }
  } else {
    tracks = await fetchRoundupCandidates(apiUrl, apiSecret, count);
  }

  if (!tracks || tracks.length === 0) {
    return { skip: true, reason: "No tracks available for roundup." };
  }

  const prefix = String(
    process.env.FB_BROWSER_POST_ROUNDUP_MESSAGE_PREFIX || "📊 This Week's Top Tracks",
  ).trim();

  const lines = [prefix, ""];
  const emojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const link = `${appUrl}/s/${encodeURIComponent(t.videoId)}`;
    const emoji = emojis[i] || `${i + 1}.`;
    lines.push(`${emoji}  ${t.artist} — ${t.title}`);
    lines.push(`    ${link}`);
    lines.push("");
  }

  lines.push("What's been on YOUR playlist this week? Drop your top tracks below! 🎵");

  const message = lines.join("\n");

  return {
    message,
    dedupeKey: dateKey,
    meta: { dateKey, count: tracks.length, tracks: tracks.map((t) => ({ videoId: t.videoId, artist: t.artist, title: t.title })) },
  };
}

// ---------------------------------------------------------------------------
// Trivia mode (text-only, no DB needed)
// ---------------------------------------------------------------------------

function loadTriviaClues() {
  const cluesPath = path.resolve(__dirname, "data", "trivia-clues.json");
  if (!fs.existsSync(cluesPath)) {
    throw new Error(`Trivia clues file not found: ${cluesPath}`);
  }

  const raw = fs.readFileSync(cluesPath, "utf8");
  const clues = JSON.parse(raw);
  if (!Array.isArray(clues) || clues.length === 0) {
    throw new Error("Trivia clues file is empty or invalid");
  }

  return clues;
}

function buildTriviaPost({ state }) {
  const clues = loadTriviaClues();
  const dedupeWindowDays = toPositiveInt(
    process.env.FB_BROWSER_POST_TRIVIA_DEDUPE_DAYS || "30",
    30,
  );

  const now = new Date();
  const dedupeCutoff = new Date(
    now.getTime() - dedupeWindowDays * 24 * 60 * 60 * 1000,
  ).getTime();

  const recentlyUsed = new Set(
    (state.posted || [])
      .filter((entry) => {
        const ts = new Date(entry.postedAt).getTime();
        return Number.isFinite(ts) && ts >= dedupeCutoff;
      })
      .map((entry) => String(entry.clueId || "").trim())
      .filter(Boolean),
  );

  const available = clues.filter((c) => !recentlyUsed.has(c.id));
  const pool = available.length > 0 ? available : clues;
  const selected = pool[Math.floor(Math.random() * pool.length)];

  const prefix = String(
    process.env.FB_BROWSER_POST_TRIVIA_MESSAGE_PREFIX || "🎸 Trivia Time! 🎸",
  ).trim();

  const message = [
    prefix,
    "",
    selected.clue,
    "",
    "Can you guess the artist and track? Drop your answer below! 👇",
    "",
    `(Answer revealed in the comments in 24 hours — hint: ${selected.hint})`,
  ].join("\n");

  return {
    message,
    dedupeKey: selected.id,
    meta: { clueId: selected.id, answer: selected.answer, tags: selected.tags },
  };
}

// ===========================================================================
// Mode dispatcher
// ===========================================================================

/**
 * Build the post content for the given mode. Returns:
 *   { message, dedupeKey, meta }  — on success
 *   { skip: true, reason, slug? }  — when the post should be skipped
 */
async function buildPost(config, state) {
  const { mode, appUrl, forceLatest } = config;

  switch (mode) {
    case "magazine":
      return buildMagazinePost({ appUrl, forceLatest, state });

    case "spotlight":
      return buildSpotlightPost({ appUrl, state });

    case "versus":
      return buildVersusPost({ appUrl, state });

    case "discussion":
      return buildDiscussionPost({ state });

    case "roundup":
      return buildRoundupPost({ appUrl, state });

    case "trivia":
      return buildTriviaPost({ state });

    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  const config = loadConfig();
  const {
    mode, loginMode, dryRun, headed, keepOpen, pauseBeforeSubmit,
    forceLatest, groupUrl, appUrl, profileDir, statePath, lockPath,
    browserChannel,
  } = config;

  const logPrefix = `facebook-browser-post:${mode}`;

  const releaseLock = acquireLock(lockPath);

  try {
    // --- Login-only mode ---
    if (loginMode) {
      await runLoginFlow(groupUrl, profileDir, browserChannel);
      console.log(`[${logPrefix}] Facebook browser profile login flow completed.`);
      return;
    }

    // --- Load state ---
    const state = readState(statePath);

    // --- Build post content ---
    const content = await buildPost(config, state);

    if (content.skip) {
      // Update state even for skips so lastCheckedAt is accurate.
      writeState(statePath, {
        ...state,
        lastCheckedAt: new Date().toISOString(),
        lastSeenSlug: content.slug || state.lastSeenSlug || null,
      });
      console.log(`[${logPrefix}] Skipped: ${content.reason}`);
      return;
    }

    if (dryRun) {
      console.log(JSON.stringify({
        status: "dry-run",
        mode,
        message: content.message,
        dedupeKey: content.dedupeKey,
        meta: content.meta,
      }, null, 2));
      return;
    }

    // --- Execute browser post flow ---
    console.log(`[${logPrefix}] Posting in ${mode} mode...`);
    const result = await runBrowserPostFlow({
      message: content.message,
      groupUrl,
      profileDir,
      headed,
      dryRun: false,
      channel: browserChannel,
      pauseBeforeSubmit,
      keepBrowserOpen: keepOpen,
      logPrefix,
    });

    if (!result.submitted) {
      console.log(`[${logPrefix}] Post was not submitted (${result.pausedBeforeSubmit ? "paused before submit" : "unknown reason"}).`);
      return;
    }

    // --- Update state ---
    const postedAt = new Date().toISOString();
    const newEntry = {
      postedAt,
      dedupeKey: content.dedupeKey,
      mode,
    };

    // Attach mode-specific metadata for deduplication lookups.
    if (content.meta) {
      Object.assign(newEntry, content.meta);
    }

    writeState(statePath, {
      posted: [...(state.posted || []), newEntry].slice(-1000),
      lastCheckedAt: postedAt,
      lastSeenSlug: content.meta?.slug || state.lastSeenSlug || null,
    });

    console.log(`[${logPrefix}] Posted successfully (key: ${content.dedupeKey}).`);
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`[facebook-browser-post] ${message}`);
  process.exit(1);
});
