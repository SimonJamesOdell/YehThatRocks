#!/usr/bin/env node

/**
 * Telegram channel auto-posting script.
 *
 * Posts new music videos and magazine articles to a Telegram channel
 * via the Telegram Bot API. Telegram channels rank in Telegram search
 * and have no algorithm suppression — every post reaches subscribers.
 *
 * Usage:
 *   node scripts/telegram-autoshare.js --dry-run
 *   node scripts/telegram-autoshare.js --force
 *
 * Prerequisites:
 *   1. Create a bot via @BotFather on Telegram, get the token
 *   2. Create a public channel (e.g. @YehThatRocks)
 *   3. Add the bot as an administrator to the channel
 *   4. The bot must have "Post messages" permission
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN — Bot token from @BotFather
 *   TELEGRAM_CHANNEL_ID — Channel username (with @) or numeric chat ID
 *
 * Optional env:
 *   TELEGRAM_MAX_POSTS_PER_DAY — max posts per day (default: 2)
 *   TELEGRAM_MIN_INTERVAL_MINUTES — min minutes between posts (default: 180)
 *   TELEGRAM_AUTOSHARE_STATE_PATH — state file path
 *   APP_URL — site URL for link in posts
 *
 * Phase 5.5 — Telegram channel distribution (TRAFFIC_ROADMAP.md)
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
const TELEGRAM_API = "https://api.telegram.org";

// ---------------------------------------------------------------------------
// Telegram Bot API
// ---------------------------------------------------------------------------

/**
 * Send a message to the Telegram channel.
 * Supports basic HTML formatting (bold, italic, links).
 */
function sendTelegramMessage(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    });

    const url = new URL(`${TELEGRAM_API}/bot${botToken}/sendMessage`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
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
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) {
              reject(new Error(`Telegram API error: ${parsed.description || "unknown"}`));
            } else {
              resolve(parsed.result);
            }
          } catch (err) {
            reject(new Error(`Telegram API parse error: ${err.message}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a photo with caption to the Telegram channel.
 * Uses a URL rather than uploading a file.
 */
function sendTelegramPhoto(botToken, chatId, photoUrl, caption) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
    });

    const url = new URL(`${TELEGRAM_API}/bot${botToken}/sendPhoto`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
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
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) {
              reject(new Error(`Telegram API error: ${parsed.description || "unknown"}`));
            } else {
              resolve(parsed.result);
            }
          } catch (err) {
            reject(new Error(`Telegram API parse error: ${err.message}`));
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
// Post builders
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildShareUrl(videoId) {
  const base = `${APP_URL}/s/${encodeURIComponent(videoId)}`;
  const utm = new URLSearchParams({
    utm_source: "telegram",
    utm_medium: "social",
    utm_campaign: "autoshare",
  });
  return `${base}?${utm.toString()}`;
}

/**
 * Build a Telegram post for a music video.
 *
 * Format:
 *   🎸 <b>ARTIST</b> — <i>TRACK</i> [Genre]
 *   🔥 Favourited X times on YehThatRocks
 *   👉 yehthatrocks.com/s/VIDEO_ID
 */
function buildVideoPost(video) {
  const artist = escapeHtml(String(video.artist || "Unknown artist").trim());
  const track = escapeHtml(String(video.title || "Unknown track").trim());
  const genre = escapeHtml(String(video.genre || "Rock / Metal").trim());
  const favourited = Number(video.favourited) || 0;
  const shareUrl = buildShareUrl(video.videoId);

  const lines = [
    `🎸 <b>${artist}</b> — <i>${track}</i> [${genre}]`,
  ];

  if (favourited > 0) {
    lines.push(`🔥 Favourited ${favourited} time${favourited === 1 ? "" : "s"} on YehThatRocks`);
  }

  lines.push("");
  lines.push(`👉 <a href="${shareUrl}">Watch on YehThatRocks</a>`);

  return lines.join("\n");
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
  const maxPostsPerDay = toPositiveInt(process.env.TELEGRAM_MAX_POSTS_PER_DAY || "2", 2);
  const minIntervalMinutes = toPositiveInt(process.env.TELEGRAM_MIN_INTERVAL_MINUTES || "180", 180);
  const statePath = path.resolve(
    process.cwd(),
    process.env.TELEGRAM_AUTOSHARE_STATE_PATH || "logs/telegram-autoshare-state.json",
  );

  const botToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const channelId = (process.env.TELEGRAM_CHANNEL_ID || "").trim();

  if (!dryRun) {
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is required. Create a bot at @BotFather.");
    if (!channelId) throw new Error("TELEGRAM_CHANNEL_ID is required. Use @YourChannelName or numeric ID.");
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
    console.log(`[telegram-autoshare] Skipped: min interval not reached. Try again in ~${remainingMin} minute(s).`);
    return;
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((p) => {
    const ts = new Date(p.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (!forceRun && postsToday >= maxPostsPerDay) {
    console.log(`[telegram-autoshare] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
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
      console.log("[telegram-autoshare] No candidates available.");
      return;
    }
  } finally {
    await prisma.$disconnect();
  }

  const selected = candidates[0];
  const text = buildVideoPost(selected);
  const thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(selected.videoId)}/maxresdefault.jpg`;

  // ── Dry-run ────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log("[telegram-autoshare] Dry run — would post:");
    console.log(JSON.stringify({
      channel: channelId,
      videoId: selected.videoId,
      artist: selected.artist,
      title: selected.title,
      genre: selected.genre,
      text,
    }, null, 2));
    return;
  }

  // ── Post to Telegram ───────────────────────────────────────────────────
  console.log(`[telegram-autoshare] Posting: ${selected.artist} — ${selected.title}`);

  let messageId;
  try {
    // Try sending photo with caption first (more engaging)
    const result = await sendTelegramPhoto(botToken, channelId, thumbnailUrl, text);
    messageId = result.message_id;
    console.log(`[telegram-autoshare] ✅ Posted with photo (msg ${messageId})`);
  } catch (photoErr) {
    // Fall back to text-only if photo fails (e.g. thumbnail unavailable)
    console.log(`[telegram-autoshare] Photo failed (${photoErr.message}), falling back to text-only...`);
    const result = await sendTelegramMessage(botToken, channelId, text);
    messageId = result.message_id;
    console.log(`[telegram-autoshare] ✅ Posted text-only (msg ${messageId})`);
  }

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
        messageId,
      },
    ].slice(-500),
  };
  writeState(statePath, nextState);
}

main().catch((error) => {
  console.error("[telegram-autoshare] Failed:", error?.message || error);
  process.exit(1);
});
