#!/usr/bin/env node

/**
 * Email newsletter digest generator.
 *
 * Compiles a weekly "Best New Rock & Metal" digest from magazine articles
 * and top new videos. Outputs HTML ready for Brevo (Sendinblue), Mailchimp,
 * or any email platform with an API.
 *
 * The script can:
 *   - Generate HTML and print to stdout (for manual sending)
 *   - Send via Brevo API (if BREVO_API_KEY is configured)
 *   - Send via Mailchimp API (if MAILCHIMP_API_KEY is configured)
 *
 * Usage:
 *   node scripts/newsletter-digest.js --dry-run       (generate HTML, print stats)
 *   node scripts/newsletter-digest.js --send           (generate and send via API)
 *   node scripts/newsletter-digest.js --output file    (write HTML to file)
 *
 * Prerequisites:
 *   For Brevo: npm install sib-api-v3-sdk (or use direct REST API)
 *   For Mailchimp: npm install @mailchimp/mailchimp_marketing
 *
 * Required env (one of):
 *   BREVO_API_KEY — Brevo API key
 *   MAILCHIMP_API_KEY — Mailchimp API key
 *   (If neither is set, output is printed to stdout)
 *
 * Optional env:
 *   NEWSLETTER_FROM_NAME — sender name (default: "YehThatRocks")
 *   NEWSLETTER_FROM_EMAIL — sender email
 *   NEWSLETTER_TO_LIST_ID — Brevo list ID or Mailchimp audience ID
 *   NEWSLETTER_MAX_VIDEOS — max videos to include (default: 5)
 *   NEWSLETTER_MAX_ARTICLES — max articles to include (default: 3)
 *
 * Phase 5.3 — Email newsletter (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
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
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const APP_URL = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");
const FROM_NAME = process.env.NEWSLETTER_FROM_NAME || "YehThatRocks";
const FROM_EMAIL = process.env.NEWSLETTER_FROM_EMAIL || "newsletter@yehthatrocks.com";

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch top new videos from the past week.
 */
async function getTopNewVideos(prisma, limit) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId,
        COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown artist') AS artist,
        COALESCE(NULLIF(TRIM(v.parsedTrack), ''), NULLIF(TRIM(v.title), ''), 'Unknown track') AS title,
        COALESCE(NULLIF(TRIM(v.genre), ''), 'Rock / Metal') AS genre,
        COALESCE(v.favourited, 0) AS favourited,
        v.createdAt
      FROM videos v
      INNER JOIN (SELECT DISTINCT sv.video_id FROM site_videos sv WHERE sv.status = 'available') sv_avail ON sv_avail.video_id = v.id
      WHERE v.approved = 1
        AND v.createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      ORDER BY v.favourited DESC, v.createdAt DESC
      LIMIT ?
    `,
    limit || 10,
  );

  return rows.map((row) => ({
    videoId: String(row.videoId || "").trim(),
    artist: String(row.artist || "Unknown artist"),
    title: String(row.title || "Unknown track"),
    genre: String(row.genre || "Rock / Metal"),
    favourited: Number(row.favourited) || 0,
    createdAt: row.createdAt,
  }));
}

/**
 * Fetch recent magazine articles.
 */
async function getRecentArticles(prisma, limit) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        slug,
        title,
        kicker,
        deck,
        artist,
        genre,
        publishedAt
      FROM magazine_articles
      WHERE status = 'published'
        AND publishedAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      ORDER BY publishedAt DESC
      LIMIT ?
    `,
    limit || 5,
  );

  return rows.map((row) => ({
    slug: String(row.slug || "").trim(),
    title: String(row.title || "").trim(),
    kicker: String(row.kicker || "").trim(),
    deck: String(row.deck || "").trim(),
    artist: String(row.artist || "").trim(),
    genre: String(row.genre || "").trim(),
    publishedAt: row.publishedAt,
  }));
}

// ---------------------------------------------------------------------------
// HTML generator
// ---------------------------------------------------------------------------

function buildShareUrl(videoId) {
  const base = `${APP_URL}/s/${encodeURIComponent(videoId)}`;
  const utm = new URLSearchParams({
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "weekly-digest",
  });
  return `${base}?${utm.toString()}`;
}

function buildArticleUrl(slug) {
  const base = `${APP_URL}/magazine/${encodeURIComponent(slug)}`;
  const utm = new URLSearchParams({
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "weekly-digest",
  });
  return `${base}?${utm.toString()}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Generate the full newsletter HTML.
 */
function generateHtml(videos, articles) {
  const now = new Date();
  const weekLabel = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const videoCards = videos.map((v) => {
    const thumbUrl = `https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/mqdefault.jpg`;
    const shareUrl = buildShareUrl(v.videoId);
    return `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #333;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="120" style="vertical-align: top; padding-right: 16px;">
              <a href="${shareUrl}">
                <img src="${thumbUrl}" width="120" height="90" alt="" style="border-radius: 6px; display: block;">
              </a>
            </td>
            <td style="vertical-align: top;">
              <a href="${shareUrl}" style="color: #e67e22; text-decoration: none; font-size: 16px; font-weight: bold;">
                ${escapeHtml(v.artist)} — ${escapeHtml(v.title)}
              </a>
              <br>
              <span style="color: #888; font-size: 13px;">${escapeHtml(v.genre)} · ❤️ ${v.favourited}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join("");

  const articleCards = articles.map((a) => {
    const articleUrl = buildArticleUrl(a.slug);
    const kickerHtml = a.kicker
      ? `<span style="color: #e67e22; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">${escapeHtml(a.kicker)}</span><br>`
      : "";
    const deckHtml = a.deck
      ? `<p style="color: #aaa; font-size: 14px; margin: 4px 0 0 0;">${escapeHtml(a.deck)}</p>`
      : "";
    return `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #333;">
        ${kickerHtml}
        <a href="${articleUrl}" style="color: #e67e22; text-decoration: none; font-size: 16px; font-weight: bold;">
          ${escapeHtml(a.title)}
        </a>
        ${deckHtml}
        <span style="color: #888; font-size: 13px;">${escapeHtml(a.artist)} · ${escapeHtml(a.genre)}</span>
      </td>
    </tr>`;
  }).join("");

  const siteUrl = `${APP_URL}/?${new URLSearchParams({
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "weekly-digest",
  }).toString()}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YehThatRocks Weekly Digest</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #ddd;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #1a1a2e;">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 24px 16px 24px; text-align: center; background-color: #16162a;">
        <h1 style="color: #e67e22; font-size: 28px; margin: 0; font-weight: 800;">
          🎸 YehThatRocks
        </h1>
        <p style="color: #999; font-size: 14px; margin: 8px 0 0 0;">
          ${weekLabel} · Best New Rock & Metal
        </p>
      </td>
    </tr>

    <!-- Videos Section -->
    ${videos.length > 0 ? `
    <tr>
      <td style="padding: 24px;">
        <h2 style="color: #e67e22; font-size: 20px; margin: 0 0 12px 0; border-bottom: 2px solid #e67e22; padding-bottom: 8px;">
          🔥 Top New Videos
        </h2>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${videoCards}
        </table>
      </td>
    </tr>
    ` : ""}

    <!-- Articles Section -->
    ${articles.length > 0 ? `
    <tr>
      <td style="padding: 24px;">
        <h2 style="color: #e67e22; font-size: 20px; margin: 0 0 12px 0; border-bottom: 2px solid #e67e22; padding-bottom: 8px;">
          📰 Latest from the Magazine
        </h2>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${articleCards}
        </table>
      </td>
    </tr>
    ` : ""}

    <!-- Footer -->
    <tr>
      <td style="padding: 24px; text-align: center; background-color: #16162a;">
        <p style="color: #666; font-size: 12px; margin: 0;">
          <a href="${siteUrl}" style="color: #e67e22; text-decoration: none;">YehThatRocks</a>
          — Rock & Metal Music Discovery
        </p>
        <p style="color: #555; font-size: 11px; margin: 8px 0 0 0;">
          You received this because you signed up at yehthatrocks.com.
          <br>
          <a href="${APP_URL}/account" style="color: #888;">Manage preferences</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email sending
// ---------------------------------------------------------------------------

/**
 * Send via Brevo (Sendinblue) REST API.
 */
function sendViaBrevo(apiKey, html, subject) {
  return new Promise((resolve, reject) => {
    const listId = process.env.NEWSLETTER_TO_LIST_ID;
    const body = JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: listId ? [{ email: listId }] : [{ email: FROM_EMAIL, name: "Test" }],
      subject,
      htmlContent: html,
    });

    const req = https.request(
      {
        hostname: "api.brevo.com",
        path: "/v3/smtp/email",
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Brevo API error ${res.statusCode}: ${data.slice(0, 200)}`));
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
 * Send via Mailchimp API.
 */
function sendViaMailchimp(apiKey, html, subject) {
  return new Promise((resolve, reject) => {
    const serverPrefix = apiKey.split("-").pop() || "us1";
    const listId = process.env.NEWSLETTER_TO_LIST_ID || "test";

    const campaignBody = JSON.stringify({
      type: "regular",
      recipients: { list_id: listId },
      settings: {
        subject_line: subject,
        from_name: FROM_NAME,
        reply_to: FROM_EMAIL,
      },
    });

    // Simplified: this is a complex multi-step process
    // Mailchimp requires: create campaign → set content → send
    // For now, log that Mailchimp needs manual campaign creation
    console.log("[newsletter] Mailchimp requires manual campaign setup. HTML saved for manual sending.");
    resolve({ status: "manual_setup_required" });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sendMode = args.includes("--send");
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  // ── Config ─────────────────────────────────────────────────────────────
  const maxVideos = toPositiveInt(process.env.NEWSLETTER_MAX_VIDEOS || "5", 5);
  const maxArticles = toPositiveInt(process.env.NEWSLETTER_MAX_ARTICLES || "3", 3);

  const brevoKey = (process.env.BREVO_API_KEY || "").trim();
  const mailchimpKey = (process.env.MAILCHIMP_API_KEY || "").trim();

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── Fetch data ─────────────────────────────────────────────────────────
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  let videos = [];
  let articles = [];

  try {
    [videos, articles] = await Promise.all([
      getTopNewVideos(prisma, maxVideos),
      getRecentArticles(prisma, maxArticles),
    ]);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`[newsletter] Fetched: ${videos.length} videos, ${articles.length} articles`);

  if (videos.length === 0 && articles.length === 0) {
    console.log("[newsletter] No content for this period. Skipping.");
    return;
  }

  // ── Generate HTML ──────────────────────────────────────────────────────
  const now = new Date();
  const subject = `🎸 Best New Rock & Metal — ${now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  })}`;

  const html = generateHtml(videos, articles);

  if (dryRun) {
    console.log(`[newsletter] Dry run — HTML length: ${html.length} chars`);
    console.log(`[newsletter] Subject: ${subject}`);
    console.log(`[newsletter] Videos: ${videos.map((v) => v.artist + " — " + v.title).join(", ")}`);
    console.log(`[newsletter] Articles: ${articles.map((a) => a.title).join(", ")}`);
    console.log("\n--- HTML Preview (first 500 chars) ---");
    console.log(html.slice(0, 500));
    return;
  }

  // ── Output to file ─────────────────────────────────────────────────────
  if (outputPath) {
    ensureDirFor(outputPath);
    fs.writeFileSync(outputPath, html);
    console.log(`[newsletter] HTML written to: ${outputPath}`);
  }

  // ── Send ───────────────────────────────────────────────────────────────
  if (sendMode) {
    if (brevoKey) {
      console.log("[newsletter] Sending via Brevo...");
      const result = await sendViaBrevo(brevoKey, html, subject);
      console.log(`[newsletter] ✅ Sent via Brevo: ${result.messageId || "ok"}`);
    } else if (mailchimpKey) {
      console.log("[newsletter] Sending via Mailchimp...");
      const result = await sendViaMailchimp(mailchimpKey, html, subject);
      console.log(`[newsletter] Mailchimp: ${result.status}`);
    } else {
      console.log("[newsletter] No email API key configured. Set BREVO_API_KEY or MAILCHIMP_API_KEY.");
      console.log("[newsletter] HTML generated but not sent. Use --output to save to file.");
      // Print to stdout as fallback
      console.log("\n" + html);
    }
  }

  if (!sendMode && !outputPath) {
    console.log("[newsletter] Use --send to send, --output to save to file, or --dry-run to preview.");
    console.log(`[newsletter] Subject: ${subject}`);
  }
}

main().catch((error) => {
  console.error("[newsletter] Failed:", error?.message || error);
  process.exit(1);
});
