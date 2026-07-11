#!/usr/bin/env node

/**
 * Discord webhook auto-posting script.
 *
 * Posts new music videos to a Discord channel via a webhook URL.
 * Discord webhooks are free, simple, and widely used by community servers.
 *
 * Each post is a rich embed with:
 *   - Thumbnail from YouTube
 *   - Artist + track title
 *   - Genre badge
 *   - Link to yehthatrocks.com
 *   - UTM parameters for tracking
 *
 * Usage:
 *   node scripts/discord-webhook-share.js --dry-run
 *   node scripts/discord-webhook-share.js --force
 *
 * Prerequisites:
 *   In your Discord server:
 *     1. Go to Server Settings → Integrations → Webhooks
 *     2. Create a webhook (name it "YehThatRocks")
 *     3. Copy the webhook URL
 *
 * Required env:
 *   DISCORD_WEBHOOK_URL — full webhook URL from Discord
 *
 * Optional env:
 *   DISCORD_MAX_POSTS_PER_DAY — max posts per day (default: 2)
 *   DISCORD_MIN_INTERVAL_MINUTES — min minutes between posts (default: 180)
 *   DISCORD_WEBHOOK_STATE_PATH — state file path
 *   APP_URL — site URL for link in posts
 *
 * Phase 5.6 — Discord webhook distribution (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const https = require("node:https");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");

// Load env before anything else
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
// Config
// ---------------------------------------------------------------------------

const APP_URL = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");

// Discord embed colour — a warm metallic orange
const EMBED_COLOR = 0xe67e22;

// ---------------------------------------------------------------------------
// Discord webhook
// ---------------------------------------------------------------------------

/**
 * Post a rich embed to a Discord webhook.
 *
 * Discord webhook format:
 *   POST {webhook_url}
 *   Body: { embeds: [{ title, description, url, color, thumbnail, fields, footer }] }
 */
function postDiscordWebhook(webhookUrl, embed) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      embeds: [embed],
    });

    const url = new URL(webhookUrl);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode });
          } else {
            // Discord returns 204 No Content on success, but some return 200
            if (res.statusCode === 204) {
              resolve({ status: 204 });
            } else {
              reject(new Error(`Discord webhook returned ${res.statusCode}: ${data.slice(0, 200)}`));
            }
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Embed builder
// ---------------------------------------------------------------------------

function buildShareUrl(videoId) {
  const base = `${APP_URL}/s/${encodeURIComponent(videoId)}`;
  const utm = new URLSearchParams({
    utm_source: "discord",
    utm_medium: "social",
    utm_campaign: "autoshare",
  });
  return `${base}?${utm.toString()}`;
}

/**
 * Build a Discord rich embed for a music video.
 *
 * Embed preview shows:
 *   ┌─────────────────────────────────┐
 *   │ 🎸 ARTIST — TRACK               │
 *   │ [Genre]  ·  ❤️ 42 favourites    │
 *   │ Watch on YehThatRocks →         │
 *   └─────────────────────────────────┘
 */
function buildVideoEmbed(video) {
  const artist = String(video.artist || "Unknown artist").trim();
  const track = String(video.title || "Unknown track").trim();
  const genre = String(video.genre || "Rock / Metal").trim();
  const favourited = Number(video.favourited) || 0;
  const shareUrl = buildShareUrl(video.videoId);
  const thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/mqdefault.jpg`;

  const embed = {
    title: `${artist} — ${track}`,
    url: shareUrl,
    color: EMBED_COLOR,
    timestamp: new Date().toISOString(),
    thumbnail: {
      url: thumbnailUrl,
    },
    footer: {
      text: "YehThatRocks — Rock & Metal Discovery",
    },
    fields: [
      {
        name: "Genre",
        value: genre,
        inline: true,
      },
    ],
  };

  if (favourited > 0) {
    embed.fields.push({
      name: "Favourites",
      value: `❤️ ${favourited}`,
      inline: true,
    });
  }

  embed.fields.push({
    name: "Watch",
    value: `[Open on YehThatRocks](${shareUrl})`,
    inline: false,
  });

  return embed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const forceRun = args.includes("--force");

  // ── Config ─────────────────────────────────────────────────────────────
  const maxPostsPerDay = toPositiveInt(process.env.DISCORD_MAX_POSTS_PER_DAY || "2", 2);
  const minIntervalMinutes = toPositiveInt(process.env.DISCORD_MIN_INTERVAL_MINUTES || "180", 180);
  const statePath = path.resolve(
    process.cwd(),
    process.env.DISCORD_WEBHOOK_STATE_PATH || "logs/discord-webhook-state.json",
  );

  const webhookUrl = (process.env.DISCORD_WEBHOOK_URL || "").trim();

  if (!dryRun && !webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is required. Get one from Discord Server Settings → Integrations → Webhooks.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── Rate limit check ───────────────────────────────────────────────────
  const now = new Date();
  const state = readState(statePath);
  const posts = Array.isArray(state.posts) ? state.posts : [];

  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const lastPostedAt = posts.length > 0
    ? Math.max(...posts.map((p) => new Date(p.postedAt).getTime()).filter((ts) => Number.isFinite(ts)))
    : null;
  if (lastPostedAt && Number.isFinite(lastPostedAt) && now.getTime() - lastPostedAt < minIntervalMs) {
    const remainingMin = Math.ceil((minIntervalMs - (now.getTime() - lastPostedAt)) / 60000);
    console.log(`[discord-webhook] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((p) => {
    const ts = new Date(p.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (!forceRun && postsToday >= maxPostsPerDay) {
    console.log(`[discord-webhook] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  // ── Candidate selection ────────────────────────────────────────────────
  const postedIds = new Set(posts.map((p) => String(p.videoId || "").trim()).filter(Boolean));

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  let candidates;
  try {
    const pool = await getTopPlayableCandidates(prisma, 300);
    const fresh = pool.filter((v) => !postedIds.has(v.videoId));
    candidates = fresh.length > 0 ? fresh : pool;

    if (candidates.length === 0) {
      console.log("[discord-webhook] No candidates available.");
      return;
    }
  } finally {
    await prisma.$disconnect();
  }

  const selected = candidates[0];
  const embed = buildVideoEmbed(selected);

  // ── Dry-run ────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log("[discord-webhook] Dry run — would post:");
    console.log(JSON.stringify({
      webhookUrl: webhookUrl ? `${webhookUrl.slice(0, 40)}...` : "(not set)",
      videoId: selected.videoId,
      artist: selected.artist,
      title: selected.title,
      genre: selected.genre,
      embed,
    }, null, 2));
    return;
  }

  // ── Post to Discord ────────────────────────────────────────────────────
  console.log(`[discord-webhook] Posting: ${selected.artist} — ${selected.title}`);

  await postDiscordWebhook(webhookUrl, embed);
  console.log(`[discord-webhook] ✅ Posted to Discord`);

  const nextState = {
    lastRunAt: now.toISOString(),
    posts: [
      ...posts,
      {
        postedAt: now.toISOString(),
        videoId: selected.videoId,
        artist: selected.artist,
        title: selected.title,
        genre: selected.genre,
      },
    ].slice(-500),
  };
  writeState(statePath, nextState);
}

main().catch((error) => {
  console.error("[discord-webhook] Failed:", error?.message || error);
  process.exit(1);
});
