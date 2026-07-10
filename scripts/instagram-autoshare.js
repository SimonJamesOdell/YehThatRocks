#!/usr/bin/env node

/**
 * Instagram auto-post script.
 *
 * Posts music video thumbnail images to an Instagram Business account
 * via the Facebook Graph API (Instagram Content Publishing).
 *
 * Prerequisites:
 *   1. Convert your Instagram account to a Business/Creator account
 *   2. Link it to your Facebook Page
 *   3. Get a Page access token with these permissions:
 *      - instagram_basic
 *      - instagram_content_publish
 *      - pages_read_engagement
 *   4. Get your Instagram Business account ID from:
 *      GET /{page-id}?fields=instagram_business_account
 *
 * Usage:
 *   node scripts/instagram-autoshare.js --dry-run
 *   node scripts/instagram-autoshare.js --force
 *   node scripts/instagram-autoshare.js --list-account
 *
 * Required env:
 *   INSTAGRAM_BUSINESS_ACCOUNT_ID — Instagram Business Account ID
 *   INSTAGRAM_ACCESS_TOKEN — Page access token with instagram_content_publish
 *
 * Optional env:
 *   INSTAGRAM_DRY_RUN — set to "0" to post live (default: "1")
 *   INSTAGRAM_MAX_POSTS_PER_DAY — max posts per day (default: 2)
 *   INSTAGRAM_MIN_INTERVAL_MINUTES — min minutes between posts (default: 240)
 *
 * Phase 2.6 — Instagram distribution (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

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
// Helpers
// ---------------------------------------------------------------------------

const APP_URL = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");

function buildShareUrl(videoId) {
  return `${APP_URL}/s/${encodeURIComponent(videoId)}?utm_source=instagram&utm_medium=social&utm_campaign=autoshare`;
}

/**
 * Build an Instagram caption (max 2,200 chars).
 * Instagram doesn't make links clickable in captions, so we use
 * the bio link and direct users there. We include the full URL
 * for users who copy-paste, plus hashtags for discovery.
 */
function buildCaption(video) {
  const artist = String(video.artist || "Unknown artist").trim();
  const track = String(video.title || "Unknown track").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  // Instagram hashtags for discoverability
  const genreTag = genre.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hashtags = [
    `#${genreTag}`,
    "#RockMusic",
    "#MetalMusic",
    "#MusicDiscovery",
    "#YehThatRocks",
  ].join(" ");

  return [
    `🎸 ${artist} — ${track}`,
    `Genre: ${genre}`,
    "",
    `🔗 Watch more at ${APP_URL}`,
    "",
    hashtags,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Instagram Graph API
// ---------------------------------------------------------------------------

/**
 * Step 1: Create a media container (upload the image).
 * Returns a creation ID used in step 2.
 */
async function createInstagramMedia({ igUserId, accessToken, imageUrl, caption }) {
  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(igUserId)}/media`;

  const payload = new URLSearchParams();
  payload.set("image_url", imageUrl);
  payload.set("caption", caption);
  payload.set("access_token", accessToken);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!response.ok) {
    const reason = parsed?.error?.message || text || `ig-http-${response.status}`;
    throw new Error(`Instagram media creation failed: ${reason}`);
  }

  return parsed?.id || null;
}

/**
 * Step 2: Publish a media container.
 * Instagram requires waiting after creation (they recommend a few seconds).
 */
async function publishInstagramMedia({ igUserId, accessToken, creationId }) {
  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(igUserId)}/media_publish`;

  const payload = new URLSearchParams();
  payload.set("creation_id", creationId);
  payload.set("access_token", accessToken);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!response.ok) {
    const reason = parsed?.error?.message || text || `ig-http-${response.status}`;
    throw new Error(`Instagram publish failed: ${reason}`);
  }

  return { id: parsed?.id || null, raw: parsed };
}

/**
 * Get Instagram Business Account info for verification.
 */
async function getInstagramAccountInfo({ igUserId, accessToken }) {
  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(igUserId)}?fields=username,name,profile_picture_url&access_token=${encodeURIComponent(accessToken)}`;

  const response = await fetch(endpoint);
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRunFromArg = args.includes("--dry-run");
  const forceRun = args.includes("--force");
  const listAccount = args.includes("--list-account");
  const dryRunFromEnv = String(process.env.INSTAGRAM_DRY_RUN || "1") === "1";
  const dryRun = dryRunFromArg ? true : (forceRun ? false : dryRunFromEnv);

  const maxPostsPerDay = toPositiveInt(process.env.INSTAGRAM_MAX_POSTS_PER_DAY || "2", 2);
  const minIntervalMinutes = toPositiveInt(process.env.INSTAGRAM_MIN_INTERVAL_MINUTES || "240", 240);
  const statePath = path.resolve(
    process.cwd(),
    process.env.INSTAGRAM_AUTOSHARE_STATE_PATH || "logs/instagram-autoshare-state.json",
  );

  const igUserId = (process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "").trim();
  const accessToken = (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();

  if (listAccount) {
    if (!igUserId || !accessToken) {
      console.log("Set INSTAGRAM_BUSINESS_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN to verify.");
      return;
    }
    const info = await getInstagramAccountInfo({ igUserId, accessToken });
    console.log("Instagram Business Account:", JSON.stringify(info, null, 2));
    return;
  }

  if (!dryRun) {
    if (!igUserId) throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID is required.");
    if (!accessToken) throw new Error("INSTAGRAM_ACCESS_TOKEN is required.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── Rate limit check ───────────────────────────────────────────────────
  const now = new Date();
  const state = readState(statePath);
  const posts = Array.isArray(state.posts) ? state.posts : [];

  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const lastPostedAt = posts.length > 0
    ? Math.max(...posts.map((p) => new Date(p.postedAt).getTime()).filter((t) => Number.isFinite(t)))
    : null;
  if (lastPostedAt && Number.isFinite(lastPostedAt) && now.getTime() - lastPostedAt < minIntervalMs) {
    const remainingMin = Math.ceil((minIntervalMs - (now.getTime() - lastPostedAt)) / 60000);
    console.log(`[instagram-autoshare] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((p) => {
    const ts = new Date(p.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;
  if (!forceRun && postsToday >= maxPostsPerDay) {
    console.log(`[instagram-autoshare] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  // ── Candidate selection ────────────────────────────────────────────────
  const postedIds = new Set(posts.map((p) => String(p.videoId || "").trim()).filter(Boolean));

  const dbAdapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: dbAdapter });

  try {
    const pool = await getTopPlayableCandidates(prisma, 200);
    const fresh = pool.filter((v) => !postedIds.has(v.videoId));
    const candidates = fresh.length > 0 ? fresh : pool;
    if (candidates.length === 0) {
      console.log("[instagram-autoshare] No candidates available.");
      return;
    }

    const selected = candidates[0]; // top by favourited
    const imageUrl = `https://i.ytimg.com/vi/${encodeURIComponent(selected.videoId)}/hqdefault.jpg`;
    const caption = buildCaption(selected);
    const shareUrl = buildShareUrl(selected.videoId);

    if (dryRun) {
      console.log("[instagram-autoshare] Dry run — would post:");
      console.log(JSON.stringify({
        imageUrl,
        caption,
        linkInBio: shareUrl,
        videoId: selected.videoId,
        artist: selected.artist,
        title: selected.title,
      }, null, 2));
      return;
    }

    // ── Create + publish ──────────────────────────────────────────────────
    console.log(`[instagram-autoshare] Posting: ${selected.artist} — ${selected.title}`);
    const creationId = await createInstagramMedia({ igUserId, accessToken, imageUrl, caption });
    if (!creationId) throw new Error("No creation ID returned from Instagram.");

    console.log(`[instagram-autoshare] Media created: ${creationId}. Waiting before publish...`);
    await new Promise((r) => setTimeout(r, 5000)); // Instagram recommends waiting

    const result = await publishInstagramMedia({ igUserId, accessToken, creationId });

    const nextState = {
      lastRunAt: now.toISOString(),
      posts: [...posts, {
        postedAt: now.toISOString(),
        videoId: selected.videoId,
        artist: selected.artist,
        title: selected.title,
        igMediaId: result.id,
      }].slice(-500),
    };
    writeState(statePath, nextState);

    console.log(`[instagram-autoshare] ✅ Posted: ${result.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[instagram-autoshare] Failed:", error?.message || error);
  process.exit(1);
});
