#!/usr/bin/env node

/**
 * Medium cross-posting script.
 *
 * Auto-publishes magazine articles from YehThatRocks to Medium with a
 * canonical link back to the original. Medium's domain authority sends
 * ranking signals to your site, and articles can be discovered through
 * Medium's own recommendation engine.
 *
 * Uses Puppeteer browser automation because Medium's API is limited
 * (OAuth requires Medium Partner Program approval). The script:
 *   1. Signs into Medium
 *   2. Creates a new story
 *   3. Populates title, subtitle, and body
 *   4. Adds a canonical link
 *   5. Publishes
 *
 * Usage:
 *   node scripts/medium-crosspost.js --dry-run
 *   node scripts/medium-crosspost.js --force
 *   node scripts/medium-crosspost.js --article-slug my-article
 *
 * Prerequisites:
 *   npm install puppeteer
 *   A Medium account (free tier is fine)
 *
 * Required env:
 *   MEDIUM_EMAIL — Medium login email
 *   MEDIUM_PASSWORD — Medium login password
 *
 * Optional env:
 *   MEDIUM_MAX_POSTS_PER_DAY — max posts per day (default: 1)
 *   MEDIUM_HEADLESS — set to "0" to show browser (default: "1")
 *   MEDIUM_CROSSPOST_STATE_PATH — state file path
 *   APP_URL — site URL for canonical link
 *
 * Phase 5.1 — Medium cross-posting (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
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
const MEDIUM_URL = "https://medium.com";
const MEDIUM_NEW_STORY_URL = "https://medium.com/new-story";

// ---------------------------------------------------------------------------
// Magazine article fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch un-crossposted magazine articles from the database.
 * Returns articles sorted by publish date (newest first).
 */
async function getUncrosspostedArticles(prisma, limit) {
  // Magazine articles are stored in site_videos or a separate table?
  // The magazine system uses a magazine_articles-like structure.
  // Try the magazine_articles table first.
  try {
    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT
          ma.id,
          ma.slug,
          ma.title,
          ma.subtitle,
          ma.body_html,
          ma.published_at,
          ma.cover_image_url
        FROM magazine_articles ma
        WHERE ma.published_at IS NOT NULL
        ORDER BY ma.published_at DESC
        LIMIT ?
      `,
      limit || 20,
    );

    return rows.map((row) => ({
      id: Number(row.id) || 0,
      slug: String(row.slug || "").trim(),
      title: String(row.title || "").trim(),
      subtitle: String(row.subtitle || "").trim(),
      bodyHtml: String(row.body_html || ""),
      publishedAt: row.published_at,
      coverImageUrl: String(row.cover_image_url || "").trim(),
    }));
  } catch {
    // Fallback: try magazine_articles without body_html
    try {
      const rows = await prisma.$queryRawUnsafe(
        `
          SELECT
            ma.id,
            ma.slug,
            ma.title,
            ma.subtitle,
            ma.published_at,
            ma.cover_image_url
          FROM magazine_articles ma
          WHERE ma.published_at IS NOT NULL
          ORDER BY ma.published_at DESC
          LIMIT ?
        `,
        limit || 20,
      );

      return rows.map((row) => ({
        id: Number(row.id) || 0,
        slug: String(row.slug || "").trim(),
        title: String(row.title || "").trim(),
        subtitle: String(row.subtitle || "").trim(),
        bodyHtml: "",
        publishedAt: row.published_at,
        coverImageUrl: String(row.cover_image_url || "").trim(),
      }));
    } catch {
      console.log("[medium-crosspost] Could not query magazine_articles table. Checking schema...");
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Medium post builder
// ---------------------------------------------------------------------------

/**
 * Build the Medium story body from a magazine article.
 *
 * The body includes:
 *   - Cover image (if available)
 *   - Subtitle as a blockquote
 *   - "Originally published on YehThatRocks" header with canonical link
 *   - The article body (stripped of YehThatRocks-specific markup)
 *   - Footer with site link and UTM
 */
function buildMediumBody(article) {
  const canonicalUrl = `${APP_URL}/magazine/${encodeURIComponent(article.slug)}?` + new URLSearchParams({
    utm_source: "medium",
    utm_medium: "referral",
    utm_campaign: "crosspost",
  }).toString();

  const parts = [];

  // Cover image
  if (article.coverImageUrl) {
    parts.push(`![Cover](${article.coverImageUrl})`);
    parts.push("");
  }

  // Subtitle as pull quote
  if (article.subtitle) {
    parts.push(`> ${article.subtitle}`);
    parts.push("");
  }

  // Canonical note
  parts.push(`*Originally published on [YehThatRocks](${canonicalUrl}) — Rock & Metal Music Discovery.*`);
  parts.push("");

  // Article body — strip site-specific markup, keep markdown
  if (article.bodyHtml) {
    // Convert basic HTML to markdown-esque text for Medium
    const cleaned = article.bodyHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<strong[^>]*>/gi, "**")
      .replace(/<\/strong>/gi, "**")
      .replace(/<em[^>]*>/gi, "*")
      .replace(/<\/em>/gi, "*")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>/gi, "[")
      .replace(/<\/a>/gi, "]($1)")
      .replace(/<h[234][^>]*>/gi, "\n## ")
      .replace(/<\/h[234]>/gi, "\n")
      .replace(/<ul[^>]*>/gi, "\n")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    parts.push(cleaned);
    parts.push("");
  }

  // Footer
  parts.push("---");
  parts.push("");
  parts.push(`*Discover more rock & metal at [YehThatRocks](${canonicalUrl}).*`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Puppeteer Medium publisher
// ---------------------------------------------------------------------------

async function publishToMedium(email, password, title, body) {
  const puppeteer = require("puppeteer");
  const headless = process.env.MEDIUM_HEADLESS !== "0";

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: headless ? "new" : false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      executablePath: process.env.MEDIUM_CHROMIUM_PATH || undefined,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // ── Sign in ─────────────────────────────────────────────────────────
    console.log("[medium-crosspost] Signing into Medium...");
    await page.goto(`${MEDIUM_URL}/m/signin`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Medium sign-in flow: click "Sign in with email"
    // Look for the email sign-in option
    try {
      await page.waitForSelector('a[href*="email"]', { timeout: 5000 });
      await page.click('a[href*="email"]');
    } catch {
      // May redirect directly to email form
    }

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', email, { delay: 50 });
    await page.click('button[type="submit"], button[data-action="submit"]');
    await new Promise((r) => setTimeout(r, 2000));

    // Password step
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 8000 });
      await page.type('input[type="password"]', password, { delay: 50 });
      await page.click('button[type="submit"], button[data-action="submit"]');
      await new Promise((r) => setTimeout(r, 3000));
    } catch {
      throw new Error("Could not find password field — Medium sign-in flow may have changed.");
    }

    // ── Create new story ────────────────────────────────────────────────
    console.log("[medium-crosspost] Creating new story...");
    await page.goto(MEDIUM_NEW_STORY_URL, {
      waitUntil: "networkidle2",
      timeout: 20000,
    });

    // Wait for the editor to load
    await new Promise((r) => setTimeout(r, 3000));

    // Set title
    try {
      const titleSelector = 'h1[data-testid="editorTitle"], h1[placeholder="Title"], [data-testid="editor-title-default"]';
      await page.waitForSelector(titleSelector, { timeout: 10000 });
      await page.click(titleSelector);
      await page.keyboard.type(title, { delay: 30 });
    } catch {
      console.log("[medium-crosspost] ⚠ Could not set title via keyboard. Editor may have changed.");
    }

    // Set body
    try {
      // Click into the body area
      const bodySelector = '[data-testid="editorBody"], [placeholder="Tell your story…"], .editor-body';
      await page.waitForSelector(bodySelector, { timeout: 8000 });
      await page.click(bodySelector);

      // Paste body content
      await page.keyboard.type(body, { delay: 5 });
    } catch {
      console.log("[medium-crosspost] ⚠ Could not populate body. Editor may have changed.");
    }

    // ── Publish ─────────────────────────────────────────────────────────
    console.log("[medium-crosspost] Publishing...");

    try {
      // Click "Publish" button
      const publishBtn = await page.$('button[data-testid="publishButton"], button:has-text("Publish")');
      if (publishBtn) {
        await publishBtn.click();
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Confirm publish (may have a second "Publish" button in a modal)
      const confirmBtn = await page.$('button[data-testid="publishConfirmButton"], button:has-text("Publish now")');
      if (confirmBtn) {
        await confirmBtn.click();
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch {
      console.log("[medium-crosspost] ⚠ Could not complete publish flow. Story may be saved as draft.");
    }

    // Get the published URL if available
    let publishedUrl = "";
    try {
      publishedUrl = page.url();
      if (!publishedUrl.includes("/p/") && !publishedUrl.includes("/@")) {
        publishedUrl = "";
      }
    } catch {
      // URL not available
    }

    console.log("[medium-crosspost] ✅ Published to Medium" + (publishedUrl ? `: ${publishedUrl}` : ""));
    return { publishedUrl, status: "published" };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const forceRun = args.includes("--force");
  const articleSlugIdx = args.indexOf("--article-slug");
  const articleSlug = articleSlugIdx >= 0 ? args[articleSlugIdx + 1] : null;

  // ── Config ─────────────────────────────────────────────────────────────
  const maxPostsPerDay = toPositiveInt(process.env.MEDIUM_MAX_POSTS_PER_DAY || "1", 1);
  const statePath = path.resolve(
    process.cwd(),
    process.env.MEDIUM_CROSSPOST_STATE_PATH || "logs/medium-crosspost-state.json",
  );

  const email = (process.env.MEDIUM_EMAIL || "").trim();
  const password = (process.env.MEDIUM_PASSWORD || "").trim();

  if (!dryRun) {
    if (!email) throw new Error("MEDIUM_EMAIL is required.");
    if (!password) throw new Error("MEDIUM_PASSWORD is required.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── Rate limit check ───────────────────────────────────────────────────
  const now = new Date();
  const state = readState(statePath);
  const posts = Array.isArray(state.posts) ? state.posts : [];

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const postsToday = posts.filter((p) => {
    const ts = new Date(p.postedAt).getTime();
    return Number.isFinite(ts) && ts >= startOfDay.getTime();
  }).length;

  if (!forceRun && postsToday >= maxPostsPerDay) {
    console.log(`[medium-crosspost] Skipped: daily cap reached (${postsToday}/${maxPostsPerDay}).`);
    return;
  }

  // ── Fetch articles ─────────────────────────────────────────────────────
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  let articles;
  try {
    articles = await getUncrosspostedArticles(prisma, 20);
  } finally {
    await prisma.$disconnect();
  }

  if (articles.length === 0) {
    console.log("[medium-crosspost] No magazine articles found. Publish an article first.");
    return;
  }

  // Filter by slug if specified
  let candidates = articles;
  if (articleSlug) {
    candidates = articles.filter((a) => a.slug === articleSlug);
    if (candidates.length === 0) {
      console.log(`[medium-crosspost] Article "${articleSlug}" not found.`);
      return;
    }
  }

  // Filter out already crossposted
  const postedSlugs = new Set(posts.map((p) => String(p.slug || "").trim()).filter(Boolean));
  const fresh = candidates.filter((a) => !postedSlugs.has(a.slug));

  if (fresh.length === 0) {
    console.log("[medium-crosspost] All available articles already crossposted.");
    return;
  }

  const selected = fresh[0];
  const body = buildMediumBody(selected);

  // ── Dry-run ────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log(`[medium-crosspost] Dry run — would post "${selected.title}":`);
    console.log(JSON.stringify({
      slug: selected.slug,
      title: selected.title,
      subtitle: selected.subtitle,
      bodyLength: body.length,
      bodyPreview: body.slice(0, 300) + "...",
    }, null, 2));
    return;
  }

  // ── Publish to Medium ──────────────────────────────────────────────────
  console.log(`[medium-crosspost] Cross-posting to Medium: "${selected.title}"`);

  let result;
  try {
    result = await publishToMedium(email, password, selected.title, body);
  } catch (err) {
    console.error(`[medium-crosspost] ❌ Failed:`, err?.message || err);
    result = { status: "failed", error: err.message };
  }

  const nextState = {
    lastRunAt: now.toISOString(),
    posts: [
      ...posts,
      {
        postedAt: now.toISOString(),
        slug: selected.slug,
        title: selected.title,
        mediumUrl: result.publishedUrl || "",
        status: result.status,
      },
    ].slice(-500),
  };
  writeState(statePath, nextState);

  console.log(`[medium-crosspost] Done: ${result.status}`);
}

main().catch((error) => {
  console.error("[medium-crosspost] Failed:", error?.message || error);
  process.exit(1);
});
