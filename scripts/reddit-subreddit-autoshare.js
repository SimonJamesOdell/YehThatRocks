#!/usr/bin/env node

/**
 * Reddit multi-subreddit auto-share script.
 *
 * Posts curated link posts to genre-matched subreddits on a controlled cadence.
 * Supports both single-subreddit mode (REDDIT_SUBREDDIT env var) and
 * multi-subreddit rotation mode (default, uses genre→subreddit mapping).
 *
 * Single-subreddit mode (backward-compatible):
 *   REDDIT_SUBREDDIT=r/Metal node scripts/reddit-subreddit-autoshare.js
 *
 * Multi-subreddit mode (default when REDDIT_SUBREDDIT is not set):
 *   node scripts/reddit-subreddit-autoshare.js
 *   node scripts/reddit-subreddit-autoshare.js --dry-run
 *   node scripts/reddit-subreddit-autoshare.js --list-subreddits
 *
 * Required env for live posting:
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
 *
 * Optional env (all have sensible defaults):
 *   REDDIT_SUBREDDIT — single subreddit name (disables multi-subreddit mode)
 *   REDDIT_USER_AGENT
 *   REDDIT_AUTOSHARE_MIN_INTERVAL_MINUTES — minimum minutes between ANY posts (default: 120)
 *   REDDIT_AUTOSHARE_MAX_POSTS_PER_DAY — total posts/day across all subreddits (default: 3)
 *   REDDIT_AUTOSHARE_PER_SUB_INTERVAL_HOURS — min hours between posts to the SAME subreddit (default: 24)
 *   REDDIT_AUTOSHARE_POOL_SIZE — candidate pool size (default: 600)
 *   REDDIT_AUTOSHARE_DEDUPE_DAYS — deduplication window (default: 90)
 *   REDDIT_AUTOSHARE_STATE_PATH — state file path
 *
 * Phase 2.1 — Multi-subreddit distribution (TRAFFIC_ROADMAP.md)
 */

"use strict";

// Load env before PrismaClient import so the datasource URL is available
try { require("dotenv").config({ path: require("node:path").resolve(process.cwd(), "apps/web/.env.local") }); } catch {}
try { require("dotenv").config(); } catch {}

const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

const {
  loadEnv,
  toPositiveInt,
  toSafeNumber,
  ensureDirFor,
  readState,
  writeState,
  pickWeightedCandidate,
  getTopPlayableCandidates,
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Genre → subreddit mapping
// ---------------------------------------------------------------------------

/**
 * Each entry maps a keyword (matched case-insensitively against video genre)
 * to one or more subreddits. Videos with genres that don't match any keyword
 * fall through to the "default" subreddits.
 */
const GENRE_SUBREDDIT_MAP = [
  // ── Metal sub-genres ──────────────────────────────────────────────────
  { keywords: ["progressive metal", "prog metal", "progressive rock", "prog rock"], subreddits: ["progmetal", "progrockmusic"] },
  { keywords: ["death metal", "deathcore", "melodic death", "technical death", "brutal death"], subreddits: ["Deathmetal", "melodicdeathmetal"] },
  { keywords: ["black metal", "blackened", "atmospheric black", "depressive black"], subreddits: ["blackmetal"] },
  { keywords: ["doom metal", "doom", "stoner doom", "funeral doom", "sludge", "sludge metal", "stoner metal", "stoner rock"], subreddits: ["doommetal", "stonerrock"] },
  { keywords: ["thrash metal", "thrash", "speed metal"], subreddits: ["thrashmetal", "Metal"] },
  { keywords: ["power metal", "power"], subreddits: ["PowerMetal"] },
  { keywords: ["symphonic metal", "symphonic"], subreddits: ["symphonicmetal", "PowerMetal"] },
  { keywords: ["metalcore", "metal core"], subreddits: ["Metalcore"] },
  { keywords: ["nu metal", "nu-metal", "numetal"], subreddits: ["numetal"] },
  { keywords: ["gothic metal", "gothic"], subreddits: ["Metal"] },
  { keywords: ["groove metal", "groove"], subreddits: ["Metal"] },
  { keywords: ["folk metal", "folk", "viking metal", "pagan metal"], subreddits: ["folkmetal", "Metal"] },
  { keywords: ["industrial metal", "industrial"], subreddits: ["industrialmetal", "Metal"] },
  { keywords: ["grindcore", "deathgrind", "goregrind"], subreddits: ["grindcore", "Deathmetal"] },
  { keywords: ["djent"], subreddits: ["Djent", "progmetal"] },

  // ── Rock sub-genres ───────────────────────────────────────────────────
  { keywords: ["classic rock", "classic"], subreddits: ["rock", "classicrock"] },
  { keywords: ["hard rock", "hardrock"], subreddits: ["rock", "hardrock"] },
  { keywords: ["alternative", "alt rock", "alt-rock"], subreddits: ["rock", "alternativerock"] },
  { keywords: ["punk", "punk rock", "hardcore punk", "post-punk"], subreddits: ["punk", "rock"] },
  { keywords: ["indie rock", "indie"], subreddits: ["rock", "indie_rock"] },
  { keywords: ["grunge", "post-grunge"], subreddits: ["grunge", "rock"] },
  { keywords: ["psychedelic", "psych rock", "psychedelic rock"], subreddits: ["psychedelicrock", "rock"] },
  { keywords: ["blues rock", "blues"], subreddits: ["rock", "bluesrock"] },
  { keywords: ["southern rock"], subreddits: ["rock"] },
  { keywords: ["glam metal", "glam rock", "hair metal"], subreddits: ["Metal", "rock"] },

  // ── Catch-all for any rock/metal genre ────────────────────────────────
  { keywords: ["rock"], subreddits: ["rock"] },
  { keywords: ["metal", "heavy metal"], subreddits: ["Metal"] },
];

/** Subreddits to use when no genre match is found. */
const DEFAULT_SUBREDDITS = ["Metal", "rock"];

/**
 * Resolve a video genre string to a set of candidate subreddits.
 * Returns an array of subreddit names (without r/ prefix).
 */
function resolveSubredditsForGenre(genre) {
  const normalizedGenre = String(genre || "").toLowerCase().trim();
  if (!normalizedGenre) return DEFAULT_SUBREDDITS;

  const results = new Set();

  for (const entry of GENRE_SUBREDDIT_MAP) {
    for (const keyword of entry.keywords) {
      if (normalizedGenre.includes(keyword) || keyword.includes(normalizedGenre)) {
        for (const sub of entry.subreddits) {
          results.add(sub);
        }
        break; // one keyword match per entry is enough
      }
    }
  }

  return results.size > 0 ? Array.from(results) : DEFAULT_SUBREDDITS;
}

// ---------------------------------------------------------------------------
// Reddit-specific helpers
// ---------------------------------------------------------------------------

/**
 * Build a post title: "Artist - Track [Genre]"
 */
function buildRedditPostTitle(video) {
  const artist = String(video.artist || "Unknown artist").trim();
  const title = String(video.title || "Unknown track").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  return `${artist} - ${title} [${genre}]`;
}

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
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!response.ok || parsed?.error) {
    const reason = parsed?.error || parsed?.message || text || `reddit-auth-http-${response.status}`;
    throw new Error(`Reddit auth failed: ${reason}`);
  }

  const token = String(parsed?.access_token || "").trim();
  if (!token) throw new Error("Reddit auth returned no access_token.");
  return token;
}

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
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!response.ok) {
    const errors = parsed?.json?.errors;
    const reason = (Array.isArray(errors) && errors.length > 0 && errors[0][1])
      || parsed?.message || text || `reddit-http-${response.status}`;
    throw new Error(`Reddit submit failed: ${reason}`);
  }

  const jsonErrors = parsed?.json?.errors;
  if (Array.isArray(jsonErrors) && jsonErrors.length > 0) {
    throw new Error(`Reddit submit error: ${jsonErrors.map((e) => e[1]).join(", ")}`);
  }

  return {
    id: parsed?.json?.data?.id || null,
    url: parsed?.json?.data?.url || null,
    raw: parsed,
  };
}

// ---------------------------------------------------------------------------
// Subreddit selection logic
// ---------------------------------------------------------------------------

/**
 * Choose which subreddit to post to next.
 *
 * Strategy: from the list of eligible subreddits (those where the per-subreddit
 * interval has elapsed), pick the one that was posted to least recently.
 * If no subreddit is eligible, return null.
 */
function selectNextSubreddit(eligibleSubreddits, state, now) {
  if (eligibleSubreddits.length === 0) return null;

  const subLastPosted = new Map();
  for (const sub of eligibleSubreddits) {
    const subPosts = state.posts
      .filter((p) => p.subreddit === sub)
      .map((p) => new Date(p.postedAt).getTime())
      .filter((ts) => Number.isFinite(ts));
    subLastPosted.set(sub, subPosts.length > 0 ? Math.max(...subPosts) : 0);
  }

  // Pick the subreddit that hasn't been posted to for the longest time
  let bestSub = eligibleSubreddits[0];
  let bestTime = subLastPosted.get(bestSub) ?? 0;
  for (const sub of eligibleSubreddits) {
    const t = subLastPosted.get(sub) ?? 0;
    if (t < bestTime) {
      bestTime = t;
      bestSub = sub;
    }
  }

  return bestSub;
}

// ---------------------------------------------------------------------------
// UTM builder
// ---------------------------------------------------------------------------

function buildShareUrl(appUrl, videoId, subreddit) {
  const base = `${appUrl}/s/${encodeURIComponent(videoId)}`;
  const utm = new URLSearchParams({
    utm_source: "reddit",
    utm_medium: "social",
    utm_campaign: "autoshare",
    utm_content: subreddit,
  });
  return `${base}?${utm.toString()}`;
}

// ---------------------------------------------------------------------------
// List subreddits command
// ---------------------------------------------------------------------------

function listSubreddits() {
  const allSubs = new Set();
  for (const entry of GENRE_SUBREDDIT_MAP) {
    for (const sub of entry.subreddits) {
      allSubs.add(sub);
    }
  }
  for (const sub of DEFAULT_SUBREDDITS) {
    allSubs.add(sub);
  }

  console.log("Target subreddits & subscriber counts:");
  const SUBS_WITH_COUNTS = {
    Metal: "1,700,000",
    progmetal: "300,000",
    rock: "600,000",
    Metalcore: "300,000",
    numetal: "100,000",
    doommetal: "140,000",
    Deathmetal: "200,000",
    stonerrock: "100,000",
    PowerMetal: "100,000",
    symphonicmetal: "30,000",
    melodicdeathmetal: "50,000",
    blackmetal: "150,000",
    thrashmetal: "40,000",
    folkmetal: "40,000",
    industrialmetal: "20,000",
    grindcore: "30,000",
    Djent: "60,000",
    classicrock: "250,000",
    hardrock: "70,000",
    alternativerock: "300,000",
    punk: "300,000",
    indie_rock: "600,000",
    grunge: "40,000",
    psychedelicrock: "100,000",
    bluesrock: "30,000",
    progrockmusic: "80,000",
    listentothis: "2,400,000",
  };

  const sorted = Array.from(allSubs).sort();
  for (const sub of sorted) {
    const count = SUBS_WITH_COUNTS[sub] || "unknown";
    console.log(`  r/${sub.padEnd(20)} ~${count} members`);
  }
  console.log(`\nTotal unique subreddits: ${sorted.length}`);
  console.log("Combined reach: ~8,000,000+ subscribers");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  // ── CLI flags ──────────────────────────────────────────────────────────
  const args = process.argv.slice(2);
  const dryRunFromArg = args.includes("--dry-run");
  const listSubs = args.includes("--list-subreddits");
  const forceFromArg = args.includes("--force");

  if (listSubs) {
    listSubreddits();
    return;
  }

  const dryRunFromEnv = String(process.env.REDDIT_AUTOSHARE_DRY_RUN || "1") === "1";
  const dryRun = dryRunFromArg ? true : (forceFromArg ? false : dryRunFromEnv);

  const singleSubreddit = (process.env.REDDIT_SUBREDDIT || "").trim();
  const multiSubMode = singleSubreddit.length === 0 || args.includes("--multi");

  // ── Rate limit config ──────────────────────────────────────────────────
  const globalMinIntervalMinutes = toPositiveInt(
    process.env.REDDIT_AUTOSHARE_MIN_INTERVAL_MINUTES || "120", 120,
  );
  const maxPostsPerDay = toPositiveInt(
    process.env.REDDIT_AUTOSHARE_MAX_POSTS_PER_DAY || "3", 3,
  );
  const perSubIntervalHours = toPositiveInt(
    process.env.REDDIT_AUTOSHARE_PER_SUB_INTERVAL_HOURS || "24", 24,
  );
  const candidatePoolSize = toPositiveInt(
    process.env.REDDIT_AUTOSHARE_POOL_SIZE || "600", 600,
  );
  const dedupeWindowDays = toPositiveInt(
    process.env.REDDIT_AUTOSHARE_DEDUPE_DAYS || "90", 90,
  );
  const statePath = path.resolve(
    process.cwd(),
    process.env.REDDIT_AUTOSHARE_STATE_PATH || "logs/reddit-subreddit-autoshare-state.json",
  );
  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const redditUsername = (process.env.REDDIT_USERNAME || "").trim();

  const userAgent = (process.env.REDDIT_USER_AGENT || "").trim()
    || `nodejs:yehthatrocks-autoshare:v2.0 (by /u/${redditUsername || "unknown"})`;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to apps/web/.env.local or current shell.");
  }
  if (!appUrl) {
    throw new Error("APP_URL is required for share links.");
  }

  if (!dryRun) {
    if (!(process.env.REDDIT_CLIENT_ID || "").trim()) throw new Error("REDDIT_CLIENT_ID is required when dry-run is disabled.");
    if (!(process.env.REDDIT_CLIENT_SECRET || "").trim()) throw new Error("REDDIT_CLIENT_SECRET is required when dry-run is disabled.");
    if (!redditUsername) throw new Error("REDDIT_USERNAME is required when dry-run is disabled.");
    if (!(process.env.REDDIT_PASSWORD || "").trim()) throw new Error("REDDIT_PASSWORD is required when dry-run is disabled.");
  }

  // ── Read state ─────────────────────────────────────────────────────────
  const now = new Date();
  const state = readState(statePath);
  const posts = Array.isArray(state.posts) ? state.posts : [];

  // ── Global rate limit check ────────────────────────────────────────────
  const globalMinIntervalMs = globalMinIntervalMinutes * 60 * 1000;
  const lastGlobalPostedAt = posts.length > 0
    ? Math.max(...posts.map((p) => new Date(p.postedAt).getTime()).filter((ts) => Number.isFinite(ts)))
    : null;
  if (lastGlobalPostedAt && Number.isFinite(lastGlobalPostedAt) && now.getTime() - lastGlobalPostedAt < globalMinIntervalMs) {
    const remainingMs = globalMinIntervalMs - (now.getTime() - lastGlobalPostedAt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    console.log(`[reddit-autoshare] Skipped: global min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  // ── Daily cap check ────────────────────────────────────────────────────
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((entry) => {
    const ts = new Date(entry.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (!forceFromArg && postsToday >= maxPostsPerDay) {
    console.log(`[reddit-autoshare] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  // ── Candidate selection ────────────────────────────────────────────────
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

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });
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

    // ── Resolve target subreddit ──────────────────────────────────────────
    let targetSubreddit;

    if (!multiSubMode && singleSubreddit.length > 0) {
      // Backward-compatible single-subreddit mode
      targetSubreddit = singleSubreddit;
    } else {
      // Multi-subreddit mode: resolve genre → candidate subreddits
      const candidateSubs = resolveSubredditsForGenre(selected.genre);
      console.log(`[reddit-autoshare] Genre "${selected.genre}" → candidates: ${candidateSubs.map((s) => `r/${s}`).join(", ")}`);

      // Filter out subreddits that were posted to within the per-sub interval
      const perSubIntervalMs = perSubIntervalHours * 60 * 60 * 1000;
      const eligibleSubs = candidateSubs.filter((sub) => {
        const subPosts = posts
          .filter((p) => p.subreddit === sub)
          .map((p) => new Date(p.postedAt).getTime())
          .filter((ts) => Number.isFinite(ts));
        if (subPosts.length === 0) return true;
        const lastPost = Math.max(...subPosts);
        return now.getTime() - lastPost >= perSubIntervalMs;
      });

      if (eligibleSubs.length === 0) {
        console.log(`[reddit-autoshare] Skipped: all candidate subreddits within ${perSubIntervalHours}h cooldown.`);
        return;
      }

      targetSubreddit = selectNextSubreddit(eligibleSubs, state, now);
      if (!targetSubreddit) {
        console.log("[reddit-autoshare] Skipped: no eligible subreddit found.");
        return;
      }
    }

    const shareLink = buildShareUrl(appUrl, selected.videoId, targetSubreddit);
    const postTitle = buildRedditPostTitle(selected);

    // ── Dry-run output ───────────────────────────────────────────────────
    if (dryRun) {
      console.log(`[reddit-autoshare] Dry run — would post to r/${targetSubreddit}:`);
      console.log(JSON.stringify({
        subreddit: `r/${targetSubreddit}`,
        title: postTitle,
        url: shareLink,
        genre: selected.genre,
        favourited: selected.favourited,
        mode: multiSubMode ? "multi-subreddit" : "single-subreddit",
      }, null, 2));
      return;
    }

    // ── Live posting ─────────────────────────────────────────────────────
    const clientId = (process.env.REDDIT_CLIENT_ID || "").trim();
    const clientSecret = (process.env.REDDIT_CLIENT_SECRET || "").trim();
    const password = (process.env.REDDIT_PASSWORD || "").trim();

    const accessToken = await getRedditAccessToken({
      clientId, clientSecret, username: redditUsername, password, userAgent,
    });

    const result = await postToRedditSubreddit({
      accessToken,
      subreddit: targetSubreddit,
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
          genre: selected.genre,
          subreddit: targetSubreddit,
          link: shareLink,
          redditPostId: result.id,
          redditPostUrl: result.url,
        },
      ].slice(-1000),
    };

    writeState(statePath, nextState);

    console.log(`[reddit-autoshare] Posted to r/${targetSubreddit} successfully.`);
    console.log(JSON.stringify({
      subreddit: `r/${targetSubreddit}`,
      redditPostId: result.id,
      redditPostUrl: result.url,
      videoId: selected.videoId,
      link: shareLink,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[reddit-autoshare] Failed:", error?.message || error);
  process.exit(1);
});
