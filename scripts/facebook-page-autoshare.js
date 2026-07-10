#!/usr/bin/env node

/**
 * Facebook page auto-post script.
 *
 * Posts curated music video links to a Facebook Page using the Graph API.
 * Follows the same pattern as facebook-group-autoshare.js but targets
 * a Page instead of a Group.
 *
 * A Facebook Page has different reach mechanics than a Group — pages appear
 * in followers' feeds and are publicly discoverable via search.
 *
 * Usage:
 *   node scripts/facebook-page-autoshare.js --dry-run
 *   node scripts/facebook-page-autoshare.js --force
 *
 * Required env:
 *   FB_PAGE_ID — your Facebook Page ID (numeric, from Page Settings → About)
 *   FB_PAGE_ACCESS_TOKEN — a never-expiring Page access token
 *     (Get from: Graph API Explorer → select your Page → Generate Token)
 *
 * Optional env:
 *   FB_PAGE_AUTOSHARE_DRY_RUN — set to "0" to enable live posting (default: "1")
 *   FB_PAGE_AUTOSHARE_MIN_INTERVAL_MINUTES — min minutes between posts (default: 120)
 *   FB_PAGE_AUTOSHARE_MAX_POSTS_PER_DAY — max posts per day (default: 3)
 *   FB_PAGE_AUTOSHARE_STATE_PATH — state file path
 *
 * Phase 2.5 — Facebook Page distribution (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
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
  pickWeightedCandidate,
  getTopPlayableCandidates,
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

function buildShareMessage(video) {
  const title = String(video.title || "Unknown track").trim();
  const artist = String(video.artist || "Unknown artist").trim();
  const genre = String(video.genre || "Rock / Metal").trim();
  return `Now playing on YehThatRocks:\n${artist} - ${title}\nGenre: ${genre}\n\nDiscover more rock & metal at yehthatrocks.com`;
}

// ---------------------------------------------------------------------------
// Facebook Graph API
// ---------------------------------------------------------------------------

async function postToFacebookPage({ pageId, accessToken, link, message }) {
  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/feed`;
  const payload = new URLSearchParams();
  payload.set("link", link);
  payload.set("message", message);
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
    const reason = parsed?.error?.message || text || `facebook-http-${response.status}`;
    throw new Error(reason);
  }

  return { id: parsed?.id || null, raw: parsed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRunFromArg = args.includes("--dry-run");
  const forceRun = args.includes("--force");
  const dryRunFromEnv = String(process.env.FB_PAGE_AUTOSHARE_DRY_RUN || "1") === "1";
  const dryRun = dryRunFromArg ? true : (forceRun ? false : dryRunFromEnv);

  const minIntervalMinutes = toPositiveInt(process.env.FB_PAGE_AUTOSHARE_MIN_INTERVAL_MINUTES || "120", 120);
  const maxPostsPerDay = toPositiveInt(process.env.FB_PAGE_AUTOSHARE_MAX_POSTS_PER_DAY || "3", 3);
  const candidatePoolSize = toPositiveInt(process.env.FB_PAGE_AUTOSHARE_POOL_SIZE || "300", 300);
  const dedupeWindowDays = toPositiveInt(process.env.FB_PAGE_AUTOSHARE_DEDUPE_DAYS || "30", 30);
  const statePath = path.resolve(
    process.cwd(),
    process.env.FB_PAGE_AUTOSHARE_STATE_PATH || "logs/facebook-page-autoshare-state.json",
  );

  const appUrl = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");
  const pageId = (process.env.FB_PAGE_ID || "").trim();
  const accessToken = (process.env.FB_PAGE_ACCESS_TOKEN || "").trim();

  if (!dryRun) {
    if (!pageId) throw new Error("FB_PAGE_ID is required.");
    if (!accessToken) throw new Error("FB_PAGE_ACCESS_TOKEN is required.");
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
    console.log(`[fb-page-autoshare] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((p) => {
    const ts = new Date(p.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;
  if (!forceRun && postsToday >= maxPostsPerDay) {
    console.log(`[fb-page-autoshare] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  // ── Candidate selection ────────────────────────────────────────────────
  const dedupeCutoff = new Date(now.getTime() - dedupeWindowDays * 24 * 60 * 60 * 1000).getTime();
  const recentlyPostedIds = new Set(
    posts
      .filter((p) => new Date(p.postedAt).getTime() >= dedupeCutoff)
      .map((p) => String(p.videoId || "").trim())
      .filter(Boolean),
  );

  const dbAdapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: dbAdapter });

  try {
    const pool = await getTopPlayableCandidates(prisma, candidatePoolSize);
    const filtered = pool.filter((v) => !recentlyPostedIds.has(v.videoId));
    const candidates = filtered.length > 0 ? filtered : pool;
    if (candidates.length === 0) {
      console.log("[fb-page-autoshare] No candidates available.");
      return;
    }

    const selected = pickWeightedCandidate(candidates);
    if (!selected) {
      console.log("[fb-page-autoshare] No candidate selected.");
      return;
    }

    const shareLink = `${appUrl}/s/${encodeURIComponent(selected.videoId)}?utm_source=facebook&utm_medium=social&utm_campaign=page_autoshare`;
    const message = buildShareMessage(selected);

    if (dryRun) {
      console.log(`[fb-page-autoshare] Dry run — would post to page ${pageId}:`);
      console.log(JSON.stringify({
        pageId,
        message,
        url: shareLink,
        videoId: selected.videoId,
        artist: selected.artist,
        title: selected.title,
      }, null, 2));
      return;
    }

    const result = await postToFacebookPage({ pageId, accessToken, link: shareLink, message });

    const nextState = {
      lastRunAt: now.toISOString(),
      posts: [...posts, {
        postedAt: now.toISOString(),
        videoId: selected.videoId,
        artist: selected.artist,
        title: selected.title,
        link: shareLink,
        fbPostId: result.id,
      }].slice(-500),
    };
    writeState(statePath, nextState);

    console.log(`[fb-page-autoshare] ✅ Posted to page: ${result.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[fb-page-autoshare] Failed:", error?.message || error);
  process.exit(1);
});
