#!/usr/bin/env node

/**
 * Reddit subreddit auto-share script.
 *
 * Posts a curated link post to r/YehThatRocks on a controlled cadence,
 * picking quality candidates from the live video catalogue.
 *
 * Modeled after scripts/facebook-group-autoshare.js with Reddit-specific
 * OAuth2 (script/password grant flow) and link-post submission.
 *
 * Usage:
 *   npm run reddit:subreddit-share             -- live (REDDIT_AUTOSHARE_DRY_RUN=1 by default)
 *   npm run reddit:subreddit-share:dry-run     -- explicit dry-run, no credentials needed
 *
 * Required env for live posting:
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 *
 * Optional env (all have sensible defaults, see .env.example):
 *   REDDIT_SUBREDDIT, REDDIT_USER_AGENT, REDDIT_AUTOSHARE_MIN_INTERVAL_MINUTES,
 *   REDDIT_AUTOSHARE_MAX_POSTS_PER_DAY, REDDIT_AUTOSHARE_POOL_SIZE,
 *   REDDIT_AUTOSHARE_DEDUPE_DAYS, REDDIT_AUTOSHARE_STATE_PATH
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

// ---------------------------------------------------------------------------
// Env loading (identical to facebook-group-autoshare.js)
// ---------------------------------------------------------------------------

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
  }
}

function loadEnv() {
  loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));
}

// ---------------------------------------------------------------------------
// Shared utilities (identical to facebook-group-autoshare.js)
// ---------------------------------------------------------------------------

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toSafeNumber(value, fallback) {
  if (fallback === undefined) { fallback = 0; }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return { posts: [], lastRunAt: null };
  }

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : null,
    };
  } catch {
    return { posts: [], lastRunAt: null };
  }
}

function writeState(statePath, state) {
  ensureDirFor(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Weighted tier pick — biases toward top-quality pool while letting
 * long-tail videos surface occasionally.
 */
function pickWeightedCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const tierA = candidates.slice(0, 120);
  const tierB = candidates.slice(120, 420);
  const tierC = candidates.slice(420);

  const availableTiers = [
    { tier: tierA, weight: 0.55 },
    { tier: tierB, weight: 0.30 },
    { tier: tierC, weight: 0.15 },
  ].filter((entry) => entry.tier.length > 0);

  if (availableTiers.length === 0) {
    return null;
  }

  const totalWeight = availableTiers.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;
  let selectedTier = availableTiers[0].tier;

  for (const entry of availableTiers) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      selectedTier = entry.tier;
      break;
    }
  }

  const pickIndex = Math.floor(Math.random() * selectedTier.length);
  return selectedTier[pickIndex] ?? candidates[0] ?? null;
}

/**
 * Fetch a quality-weighted pool of playable catalogue videos.
 * Identical query to facebook-group-autoshare.js.
 */
async function getTopPlayableCandidates(prisma, poolSize) {
  const limit = Math.max(50, Math.min(poolSize, 2000));

  const videoColumns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM videos");
  const columnSet = new Set(videoColumns.map((col) => String(col.Field || "").trim()));

  const artistExpr = columnSet.has("parsedArtist")
    ? "COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown artist')"
    : "'Unknown artist'";
  const titleExpr = columnSet.has("parsedTrack")
    ? "COALESCE(NULLIF(TRIM(v.parsedTrack), ''), NULLIF(TRIM(v.title), ''), 'Unknown track')"
    : "COALESCE(NULLIF(TRIM(v.title), ''), 'Unknown track')";
  const genreExpr = columnSet.has("genre")
    ? "COALESCE(NULLIF(TRIM(v.genre), ''), 'Rock / Metal')"
    : "'Rock / Metal'";
  const favouritedExpr = columnSet.has("favourited") ? "COALESCE(v.favourited, 0)" : "0";

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId AS videoId,
        ${artistExpr} AS artist,
        ${titleExpr} AS title,
        ${genreExpr} AS genre,
        ${favouritedExpr} AS favourited,
        v.id AS internalId
      FROM videos v
      INNER JOIN (SELECT DISTINCT sv.video_id FROM site_videos sv WHERE sv.status = 'available') sv_avail ON sv_avail.video_id = v.id
      WHERE v.videoId IS NOT NULL
      ORDER BY ${favouritedExpr} DESC, v.id DESC
      LIMIT ?
    `,
    limit,
  );

  return rows
    .map((row) => ({
      videoId: String(row.videoId || "").trim(),
      artist: String(row.artist || "Unknown artist"),
      title: String(row.title || "Unknown track"),
      genre: String(row.genre || "Rock / Metal"),
      favourited: toSafeNumber(row.favourited, 0),
      internalId: toSafeNumber(row.internalId, 0),
    }))
    .filter((row) => row.videoId.length === 11);
}

// ---------------------------------------------------------------------------
// Reddit-specific helpers
// ---------------------------------------------------------------------------

/**
 * Build a post title: "Artist - Track [Genre]"
 * Keeps it human-readable with no promotional copy so it fits naturally
 * in a music discovery subreddit.
 */
function buildRedditPostTitle(video) {
  const artist = String(video.artist || "Unknown artist").trim();
  const title = String(video.title || "Unknown track").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  return `${artist} - ${title} [${genre}]`;
}

/**
 * Obtain a Reddit OAuth2 bearer token via the password grant (script app) flow.
 *
 * Docs: https://github.com/reddit-archive/reddit/wiki/OAuth2#application-only-oauth
 * Requires a "script" type app at https://www.reddit.com/prefs/apps
 */
async function getRedditAccessToken({ clientId, clientSecret, username, password, userAgent }) {
  const endpoint = "https://www.reddit.com/api/v1/access_token";

  const payload = new URLSearchParams();
  payload.set("grant_type", "password");
  payload.set("username", username);
  payload.set("password", password);

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: payload,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok || parsed?.error) {
    const reason = parsed?.error || parsed?.message || text || `reddit-auth-http-${response.status}`;
    throw new Error(`Reddit auth failed: ${reason}`);
  }

  const token = String(parsed?.access_token || "").trim();
  if (!token) {
    throw new Error("Reddit auth returned no access_token.");
  }

  return token;
}

/**
 * Submit a link post to a subreddit.
 *
 * Docs: https://www.reddit.com/dev/api#POST_api_submit
 */
async function postToRedditSubreddit({ accessToken, subreddit, title, url, userAgent, resubmit = false }) {
  const endpoint = "https://oauth.reddit.com/api/submit";

  const payload = new URLSearchParams();
  payload.set("kind", "link");
  payload.set("sr", subreddit);
  payload.set("title", title);
  payload.set("url", url);
  payload.set("resubmit", String(resubmit));
  payload.set("nsfw", "false");
  payload.set("spoiler", "false");
  payload.set("api_type", "json");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: payload,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const errors = parsed?.json?.errors;
    const reason =
      (Array.isArray(errors) && errors.length > 0 && errors[0][1]) ||
      parsed?.message ||
      text ||
      `reddit-http-${response.status}`;
    throw new Error(`Reddit submit failed: ${reason}`);
  }

  // Reddit returns errors in json.errors even on HTTP 200
  const jsonErrors = parsed?.json?.errors;
  if (Array.isArray(jsonErrors) && jsonErrors.length > 0) {
    throw new Error(`Reddit submit error: ${jsonErrors.map((e) => e[1]).join(", ")}`);
  }

  const postId = parsed?.json?.data?.id || null;
  const postUrl = parsed?.json?.data?.url || null;

  return { id: postId, url: postUrl, raw: parsed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const dryRunFromArg = process.argv.includes("--dry-run");
  const dryRunFromEnv = String(process.env.REDDIT_AUTOSHARE_DRY_RUN || "1") === "1";
  const dryRun = dryRunFromArg || dryRunFromEnv;

  // Conservative Reddit defaults: 2 posts/day with 8h minimum gap
  const minIntervalMinutes = toPositiveInt(process.env.REDDIT_AUTOSHARE_MIN_INTERVAL_MINUTES || "480", 480);
  const maxPostsPerDay = toPositiveInt(process.env.REDDIT_AUTOSHARE_MAX_POSTS_PER_DAY || "2", 2);
  const candidatePoolSize = toPositiveInt(process.env.REDDIT_AUTOSHARE_POOL_SIZE || "600", 600);
  const dedupeWindowDays = toPositiveInt(process.env.REDDIT_AUTOSHARE_DEDUPE_DAYS || "60", 60);
  const statePath = path.resolve(
    process.cwd(),
    process.env.REDDIT_AUTOSHARE_STATE_PATH || "logs/reddit-subreddit-autoshare-state.json",
  );
  const subreddit = (process.env.REDDIT_SUBREDDIT || "YehThatRocks").trim();
  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const redditUsername = (process.env.REDDIT_USERNAME || "").trim();

  // Reddit API requires: <platform>:<app_id>:<version> (by /u/<username>)
  const userAgent =
    (process.env.REDDIT_USER_AGENT || "").trim() ||
    `nodejs:yehthatrocks-autoshare:v1.0 (by /u/${redditUsername || "unknown"})`;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to apps/web/.env.local or current shell.");
  }

  if (!appUrl) {
    throw new Error("APP_URL is required for share links.");
  }

  if (!dryRun) {
    if (!(process.env.REDDIT_CLIENT_ID || "").trim()) {
      throw new Error("REDDIT_CLIENT_ID is required when dry-run is disabled.");
    }
    if (!(process.env.REDDIT_CLIENT_SECRET || "").trim()) {
      throw new Error("REDDIT_CLIENT_SECRET is required when dry-run is disabled.");
    }
    if (!redditUsername) {
      throw new Error("REDDIT_USERNAME is required when dry-run is disabled.");
    }
    if (!(process.env.REDDIT_PASSWORD || "").trim()) {
      throw new Error("REDDIT_PASSWORD is required when dry-run is disabled.");
    }
  }

  // ------------------------------------------------------------------
  // Rate-limit and cap checks
  // ------------------------------------------------------------------

  const now = new Date();
  const state = readState(statePath);
  const posts = Array.isArray(state.posts) ? state.posts : [];

  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const lastPostedAt = posts.length > 0 ? new Date(posts[posts.length - 1].postedAt).getTime() : null;
  if (lastPostedAt && Number.isFinite(lastPostedAt) && now.getTime() - lastPostedAt < minIntervalMs) {
    const remainingMs = minIntervalMs - (now.getTime() - lastPostedAt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    console.log(`[reddit-autoshare] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((entry) => {
    const ts = new Date(entry.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (postsToday >= maxPostsPerDay) {
    console.log(`[reddit-autoshare] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  // ------------------------------------------------------------------
  // Candidate selection
  // ------------------------------------------------------------------

  const dedupeCutoff = new Date(now.getTime() - dedupeWindowDays * 24 * 60 * 60 * 1000).getTime();
  const recentlyPostedIds = new Set(
    posts
      .filter((entry) => {
        const ts = new Date(entry.postedAt).getTime();
        return Number.isFinite(ts) && ts >= dedupeCutoff;
      })
      .map((entry) => String(entry.videoId || "").trim())
      .filter(Boolean),
  );

  const prisma = new PrismaClient();
  try {
    const pool = await getTopPlayableCandidates(prisma, candidatePoolSize);
    const filteredPool = pool.filter((video) => !recentlyPostedIds.has(video.videoId));
    const candidates = filteredPool.length > 0 ? filteredPool : pool;

    if (candidates.length === 0) {
      console.log("[reddit-autoshare] Skipped: no playable candidates available.");
      return;
    }

    const selected = pickWeightedCandidate(candidates);
    if (!selected) {
      console.log("[reddit-autoshare] Skipped: no candidate selected.");
      return;
    }

    const shareLink = `${appUrl}/s/${encodeURIComponent(selected.videoId)}`;
    const postTitle = buildRedditPostTitle(selected);

    // ------------------------------------------------------------------
    // Dry-run output
    // ------------------------------------------------------------------

    if (dryRun) {
      console.log("[reddit-autoshare] Dry run: would post the following payload:");
      console.log(
        JSON.stringify(
          {
            subreddit: `r/${subreddit}`,
            title: postTitle,
            url: shareLink,
            selected,
          },
          null,
          2,
        ),
      );
      return;
    }

    // ------------------------------------------------------------------
    // Live posting: obtain token then submit
    // ------------------------------------------------------------------

    const clientId = (process.env.REDDIT_CLIENT_ID || "").trim();
    const clientSecret = (process.env.REDDIT_CLIENT_SECRET || "").trim();
    const password = (process.env.REDDIT_PASSWORD || "").trim();

    const accessToken = await getRedditAccessToken({
      clientId,
      clientSecret,
      username: redditUsername,
      password,
      userAgent,
    });

    const result = await postToRedditSubreddit({
      accessToken,
      subreddit,
      title: postTitle,
      url: shareLink,
      userAgent,
    });

    const nextState = {
      lastRunAt: now.toISOString(),
      posts: [
        ...posts,
        {
          postedAt: now.toISOString(),
          videoId: selected.videoId,
          title: selected.title,
          artist: selected.artist,
          subreddit,
          link: shareLink,
          redditPostId: result.id,
          redditPostUrl: result.url,
        },
      ].slice(-500),
    };

    writeState(statePath, nextState);

    console.log("[reddit-autoshare] Posted successfully.");
    console.log(
      JSON.stringify(
        { redditPostId: result.id, redditPostUrl: result.url, videoId: selected.videoId, link: shareLink },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[reddit-autoshare] Failed:", error?.message || error);
  process.exit(1);
});
