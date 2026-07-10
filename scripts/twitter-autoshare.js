#!/usr/bin/env node

/**
 * Twitter/X auto-posting script.
 *
 * Posts tweets for newly approved music videos using the Twitter API v2.
 * Uses OAuth 1.0a User Context for tweet creation (required by X API).
 *
 * Usage:
 *   node scripts/twitter-autoshare.js --dry-run
 *   node scripts/twitter-autoshare.js --force
 *
 * Prerequisites:
 *   npm install twitter-api-v2
 *
 *   Create a Twitter app at https://developer.twitter.com/en/portal/dashboard
 *   (Free tier: 1,500 tweets/month, 50/day — plenty for our cadence)
 *
 * Required env:
 *   TWITTER_API_KEY — Twitter API Key (consumer key)
 *   TWITTER_API_SECRET — Twitter API Secret (consumer secret)
 *   TWITTER_ACCESS_TOKEN — OAuth 1.0a access token
 *   TWITTER_ACCESS_SECRET — OAuth 1.0a access token secret
 *
 * Optional env:
 *   TWITTER_MAX_TWEETS_PER_DAY — max tweets per day (default: 3)
 *   TWITTER_MIN_INTERVAL_MINUTES — min minutes between tweets (default: 120)
 *   TWITTER_AUTOSHARE_STATE_PATH — state file path
 *
 * Phase 2.4 — Twitter/X distribution (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
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
// Tweet builder
// ---------------------------------------------------------------------------

const APP_URL = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");

/**
 * Build a tweet for a video. Keeps it under 280 chars.
 *
 * Format: "ARTIST — TRACK [Genre] 🔥"
 *          "yehthatrocks.com/s/VIDEO_ID"
 *
 * With UTM: utm_source=twitter&utm_medium=social&utm_campaign=autoshare
 */
function buildTweet(video) {
  const artist = String(video.artist || "Unknown artist").trim();
  const track = String(video.title || "Unknown track").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  const shareUrl = buildShareUrl(video.videoId);

  // Twitter counts URLs as 23 characters regardless of length
  const URL_WEIGHT = 23;
  const maxTextLength = 280 - URL_WEIGHT - 1; // -1 for the space before URL

  let text = `${artist} — ${track} [${genre}] 🔥`;

  // Truncate if too long
  if (text.length > maxTextLength) {
    const available = maxTextLength - 3; // room for "..."
    text = `${artist} — ${track}`;
    if (text.length > available) {
      text = text.slice(0, available - 3) + "...";
    }
  }

  return { text, url: shareUrl };
}

function buildShareUrl(videoId) {
  const base = `${APP_URL}/s/${encodeURIComponent(videoId)}`;
  const utm = new URLSearchParams({
    utm_source: "twitter",
    utm_medium: "social",
    utm_campaign: "autoshare",
  });
  return `${base}?${utm.toString()}`;
}

// ---------------------------------------------------------------------------
// Twitter API v2 (OAuth 1.0a)
// ---------------------------------------------------------------------------

/**
 * Post a tweet using Twitter API v2 with OAuth 1.0a User Context.
 * Uses the twitter-api-v2 package for reliable OAuth signing.
 */
async function postTweet(credentials, tweetText, tweetUrl) {
  const { TwitterApi } = require("twitter-api-v2");

  const client = new TwitterApi({
    appKey: credentials.apiKey,
    appSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessSecret,
  });

  const fullText = `${tweetText}\n${tweetUrl}`;
  const result = await client.v2.tweet(fullText);

  return {
    id: result.data.id,
    text: result.data.text,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const forceRun = args.includes("--force");

  // ── Config ─────────────────────────────────────────────────────────────
  const maxTweetsPerDay = toPositiveInt(process.env.TWITTER_MAX_TWEETS_PER_DAY || "3", 3);
  const minIntervalMinutes = toPositiveInt(process.env.TWITTER_MIN_INTERVAL_MINUTES || "120", 120);
  const statePath = path.resolve(
    process.cwd(),
    process.env.TWITTER_AUTOSHARE_STATE_PATH || "logs/twitter-autoshare-state.json",
  );

  const apiKey = (process.env.TWITTER_API_KEY || "").trim();
  const apiSecret = (process.env.TWITTER_API_SECRET || "").trim();
  const accessToken = (process.env.TWITTER_ACCESS_TOKEN || "").trim();
  const accessSecret = (process.env.TWITTER_ACCESS_SECRET || "").trim();

  if (!dryRun) {
    if (!apiKey) throw new Error("TWITTER_API_KEY is required.");
    if (!apiSecret) throw new Error("TWITTER_API_SECRET is required.");
    if (!accessToken) throw new Error("TWITTER_ACCESS_TOKEN is required.");
    if (!accessSecret) throw new Error("TWITTER_ACCESS_SECRET is required.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── Rate limit check ───────────────────────────────────────────────────
  const now = new Date();
  const state = readState(statePath);
  const tweets = Array.isArray(state.tweets) ? state.tweets : [];

  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const lastTweetedAt = tweets.length > 0
    ? Math.max(...tweets.map((t) => new Date(t.tweetedAt).getTime()).filter((ts) => Number.isFinite(ts)))
    : null;
  if (lastTweetedAt && Number.isFinite(lastTweetedAt) && now.getTime() - lastTweetedAt < minIntervalMs) {
    const remainingMin = Math.ceil((minIntervalMs - (now.getTime() - lastTweetedAt)) / 60000);
    console.log(`[twitter-autoshare] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const tweetsToday = tweets.filter((t) => {
    const ts = new Date(t.tweetedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (!forceRun && tweetsToday >= maxTweetsPerDay) {
    console.log(`[twitter-autoshare] Skipped: daily cap reached (${tweetsToday}/${maxTweetsPerDay}).`);
    return;
  }

  // ── Candidate selection ────────────────────────────────────────────────
  const tweetedIds = new Set(tweets.map((t) => String(t.videoId || "").trim()).filter(Boolean));

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  let candidates;
  try {
    const pool = await getTopPlayableCandidates(prisma, 300);
    const fresh = pool.filter((v) => !tweetedIds.has(v.videoId));
    candidates = fresh.length > 0 ? fresh : pool;

    if (candidates.length === 0) {
      console.log("[twitter-autoshare] No candidates available.");
      return;
    }
  } finally {
    await prisma.$disconnect();
  }

  // Pick the top candidate (highest favourited)
  const selected = candidates[0];
  const { text, url } = buildTweet(selected);

  // ── Dry-run ────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log("[twitter-autoshare] Dry run — would tweet:");
    console.log(JSON.stringify({
      text,
      url,
      videoId: selected.videoId,
      artist: selected.artist,
      title: selected.title,
      genre: selected.genre,
    }, null, 2));
    return;
  }

  // ── Post tweet ─────────────────────────────────────────────────────────
  console.log(`[twitter-autoshare] Tweeting: ${selected.artist} — ${selected.title}`);

  const result = await postTweet(
    { apiKey, apiSecret, accessToken, accessSecret },
    text,
    url,
  );

  const nextState = {
    lastRunAt: now.toISOString(),
    tweets: [
      ...tweets,
      {
        tweetedAt: now.toISOString(),
        videoId: selected.videoId,
        artist: selected.artist,
        title: selected.title,
        genre: selected.genre,
        tweetId: result.id,
        text: result.text,
      },
    ].slice(-500),
  };
  writeState(statePath, nextState);

  console.log(`[twitter-autoshare] ✅ Tweeted: ${result.id}`);
}

main().catch((error) => {
  console.error("[twitter-autoshare] Failed:", error?.message || error);
  process.exit(1);
});
