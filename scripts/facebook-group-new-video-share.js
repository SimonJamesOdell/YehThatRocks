#!/usr/bin/env node

"use strict";

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
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

function buildShareMessage(video) {
  const title = String(video.title || "Unknown track").trim();
  const artist = String(video.artist || "Unknown artist").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  return `New on YehThatRocks:\n${artist} - ${title}\nGenre: ${genre}\n\nFreshly approved — what do you think?`;
}

// ---------------------------------------------------------------------------
// Facebook Graph API
// ---------------------------------------------------------------------------

async function postToFacebookGroup({ groupId, accessToken, link, message }) {
  const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(groupId)}/feed`;
  const payload = new URLSearchParams();
  payload.set("link", link);
  payload.set("message", message);
  payload.set("access_token", accessToken);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
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
    const reason = parsed?.error?.message || text || `facebook-http-${response.status}`;
    throw new Error(reason);
  }

  return {
    id: parsed?.id || null,
    raw: parsed,
  };
}

// ---------------------------------------------------------------------------
// Candidate fetch — last N approved + site-available videos (newest-first)
// ---------------------------------------------------------------------------

async function getLatestApprovedVideos(prisma, poolSize) {
  const limit = Math.max(50, Math.min(poolSize, 500));

  // Check which columns exist so the query is resilient across schema versions.
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

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId AS videoId,
        ${artistExpr} AS artist,
        ${titleExpr} AS title,
        ${genreExpr} AS genre,
        v.id AS internalId
      FROM videos v
      WHERE v.videoId IS NOT NULL
        AND COALESCE(v.approved, 0) = 1
        AND EXISTS (
          SELECT 1
          FROM site_videos sv
          WHERE sv.video_id = v.id
            AND sv.status = 'available'
        )
      ORDER BY COALESCE(v.approved_at, v.created_at) DESC, v.id DESC
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
      internalId: toSafeNumber(row.internalId, 0),
    }))
    .filter((row) => row.videoId.length > 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const dryRunFromArg = process.argv.includes("--dry-run");
  const dryRunFromEnv = String(process.env.FB_GROUP_NEW_VIDEO_DRY_RUN || "1") === "1";
  const dryRun = dryRunFromArg || dryRunFromEnv;

  const minIntervalMinutes = toPositiveInt(process.env.FB_GROUP_NEW_VIDEO_MIN_INTERVAL_MINUTES || "60", 60);
  const maxPostsPerDay = toPositiveInt(process.env.FB_GROUP_NEW_VIDEO_MAX_POSTS_PER_DAY || "6", 6);
  const candidatePoolSize = toPositiveInt(process.env.FB_GROUP_NEW_VIDEO_POOL_SIZE || "200", 200);
  const dedupeWindowDays = toPositiveInt(process.env.FB_GROUP_NEW_VIDEO_DEDUPE_DAYS || "14", 14);
  const statePath = path.resolve(
    process.cwd(),
    process.env.FB_GROUP_NEW_VIDEO_STATE_PATH || "logs/facebook-group-new-video-share-state.json",
  );

  const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  const groupId = (process.env.FB_GROUP_ID || "").trim();
  const accessToken = (process.env.FB_GROUP_ACCESS_TOKEN || "").trim();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add it to apps/web/.env.local or current shell.");
  }

  if (!appUrl) {
    throw new Error("APP_URL is required for share links.");
  }

  if (!dryRun) {
    if (!groupId) {
      throw new Error("FB_GROUP_ID is required when dry-run is disabled.");
    }
    if (!accessToken) {
      throw new Error("FB_GROUP_ACCESS_TOKEN is required when dry-run is disabled.");
    }
  }

  const now = new Date();
  const state = readState(statePath);
  const posts = Array.isArray(state.posts) ? state.posts : [];

  // Min interval check.
  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const lastPostedAt = posts.length > 0 ? new Date(posts[posts.length - 1].postedAt).getTime() : null;
  if (lastPostedAt && Number.isFinite(lastPostedAt) && now.getTime() - lastPostedAt < minIntervalMs) {
    const remainingMs = minIntervalMs - (now.getTime() - lastPostedAt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    console.log(`[facebook-new-video-share] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  // Daily cap check.
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((entry) => {
    const ts = new Date(entry.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (postsToday >= maxPostsPerDay) {
    console.log(`[facebook-new-video-share] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  // Dedupe: exclude videos posted within the dedupe window.
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

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL),
  });
  try {
    const pool = await getLatestApprovedVideos(prisma, candidatePoolSize);
    const filteredPool = pool.filter((video) => !recentlyPostedIds.has(video.videoId));
    const candidates = filteredPool.length > 0 ? filteredPool : pool;

    if (candidates.length === 0) {
      console.log("[facebook-new-video-share] Skipped: no approved & available candidates.");
      return;
    }

    // Simple random pick — no weighting tiers here because the pool itself
    // is already scoped to the freshest approved videos.
    const pickIndex = Math.floor(Math.random() * candidates.length);
    const selected = candidates[pickIndex];

    if (!selected) {
      console.log("[facebook-new-video-share] Skipped: no candidate selected.");
      return;
    }

    const shareLink = `${appUrl}/s/${encodeURIComponent(selected.videoId)}`;
    const message = buildShareMessage(selected);

    if (dryRun) {
      console.log("[facebook-new-video-share] Dry run: would post the following payload:");
      console.log(JSON.stringify({
        groupId: groupId || "<not-set>",
        link: shareLink,
        message,
        selected,
        poolSize: pool.length,
        candidatesAfterDedupe: candidates.length,
      }, null, 2));
      return;
    }

    const result = await postToFacebookGroup({
      groupId,
      accessToken,
      link: shareLink,
      message,
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
          link: shareLink,
          facebookPostId: result.id,
        },
      ].slice(-500),
    };

    writeState(statePath, nextState);

    console.log("[facebook-new-video-share] Posted successfully.");
    console.log(JSON.stringify({
      facebookPostId: result.id,
      videoId: selected.videoId,
      link: shareLink,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[facebook-new-video-share] Failed:", error?.message || error);
  process.exit(1);
});
