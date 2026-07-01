#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { parseArg } = require("./lib/cli");

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

function buildShareMessage(video) {
  const title = String(video.title || "Unknown track").trim();
  const artist = String(video.artist || "Unknown artist").trim();
  const genre = String(video.genre || "Rock / Metal").trim();

  return `Now playing on YehThatRocks:\n${artist} - ${title}\nGenre: ${genre}\n\nWhat do you think of this one?`;
}

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

// getTopPlayableCandidates imported from ./lib/social-share-utils

async function main() {
  loadEnv();

  const dryRunFromArg = process.argv.includes("--dry-run");
  const dryRunFromEnv = String(process.env.FB_GROUP_AUTOSHARE_DRY_RUN || "1") === "1";
  const dryRun = dryRunFromArg || dryRunFromEnv;

  const minIntervalMinutes = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_MIN_INTERVAL_MINUTES || "180", 180);
  const maxPostsPerDay = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_MAX_POSTS_PER_DAY || "4", 4);
  const candidatePoolSize = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_POOL_SIZE || "600", 600);
  const dedupeWindowDays = toPositiveInt(process.env.FB_GROUP_AUTOSHARE_DEDUPE_DAYS || "30", 30);
  const statePath = path.resolve(
    process.cwd(),
    process.env.FB_GROUP_AUTOSHARE_STATE_PATH || "logs/facebook-group-autoshare-state.json",
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

  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const lastPostedAt = posts.length > 0 ? new Date(posts[posts.length - 1].postedAt).getTime() : null;
  if (lastPostedAt && Number.isFinite(lastPostedAt) && now.getTime() - lastPostedAt < minIntervalMs) {
    const remainingMs = minIntervalMs - (now.getTime() - lastPostedAt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    console.log(`[facebook-autoshare] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((entry) => {
    const ts = new Date(entry.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (postsToday >= maxPostsPerDay) {
    console.log(`[facebook-autoshare] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

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
      console.log("[facebook-autoshare] Skipped: no playable candidates available.");
      return;
    }

    const selected = pickWeightedCandidate(candidates);
    if (!selected) {
      console.log("[facebook-autoshare] Skipped: no candidate selected.");
      return;
    }

    const shareLink = `${appUrl}/s/${encodeURIComponent(selected.videoId)}`;
    const message = buildShareMessage(selected);

    if (dryRun) {
      console.log("[facebook-autoshare] Dry run: would post the following payload:");
      console.log(JSON.stringify({
        groupId: groupId || "<not-set>",
        link: shareLink,
        message,
        selected,
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

    console.log("[facebook-autoshare] Posted successfully.");
    console.log(JSON.stringify({ facebookPostId: result.id, videoId: selected.videoId, link: shareLink }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[facebook-autoshare] Failed:", error?.message || error);
  process.exit(1);
});