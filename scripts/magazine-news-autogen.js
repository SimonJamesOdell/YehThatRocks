#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const mysql = require("mysql2/promise");

const NEWS_FEEDS = [
  { name: "BBC Entertainment", url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml" },
  { name: "The Guardian Music", url: "https://www.theguardian.com/music/rss" },
  { name: "NME", url: "https://www.nme.com/news/music/feed" },
  { name: "Loudwire", url: "https://loudwire.com/feed/" },
  { name: "Metal Injection", url: "https://metalinjection.net/feed" },
  { name: "Blabbermouth", url: "https://blabbermouth.net/feed" },
];

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z0-9-]+)(?:=(.*))?$/);
    if (!m) continue;
    args[m[1]] = m[2] ?? true;
  }
  return args;
}

function toInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^"/, "").replace(/"$/, "");
  }
}

function loadEnv() {
  loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));
}

function stripHtml(input) {
  return String(input || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? stripHtml(m[1]) : "";
}

function parseRssItems(xml, feedName) {
  const items = [];
  const rssItems = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const itemXml of rssItems) {
    const title = pickTag(itemXml, "title");
    const link = pickTag(itemXml, "link");
    const pubDateRaw = pickTag(itemXml, "pubDate") || pickTag(itemXml, "dc:date");
    const description = pickTag(itemXml, "description");
    if (!title || !link) continue;
    const publishedAt = Number.isFinite(Date.parse(pubDateRaw)) ? new Date(pubDateRaw) : new Date();
    items.push({ source: feedName, title, link, summary: description, publishedAt });
  }

  if (items.length > 0) {
    return items;
  }

  const atomEntries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const entryXml of atomEntries) {
    const title = pickTag(entryXml, "title");
    const summary = pickTag(entryXml, "summary") || pickTag(entryXml, "content");
    const updatedRaw = pickTag(entryXml, "updated") || pickTag(entryXml, "published");
    const linkMatch = entryXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
    const link = linkMatch ? stripHtml(linkMatch[1]) : "";
    if (!title || !link) continue;
    const publishedAt = Number.isFinite(Date.parse(updatedRaw)) ? new Date(updatedRaw) : new Date();
    items.push({ source: feedName, title, link, summary, publishedAt });
  }

  return items;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "YehThatRocksMagazineBot/1.0 (+https://yehthatrocks.com)",
      "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.text();
}

async function fetchNewsItems(newsWindowHours) {
  const settled = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url);
      return parseRssItems(xml, feed.name);
    }),
  );

  const now = Date.now();
  const cutoffMs = newsWindowHours * 60 * 60 * 1000;
  const all = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      all.push(...result.value);
    }
  }

  const byLink = new Map();
  for (const item of all) {
    if (!item.link) continue;
    const age = now - item.publishedAt.getTime();
    if (age > cutoffMs) continue;
    const key = item.link.trim().toLowerCase();
    const prev = byLink.get(key);
    if (!prev || item.publishedAt.getTime() > prev.publishedAt.getTime()) {
      byLink.set(key, item);
    }
  }

  return [...byLink.values()].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

function parseDatabaseUrl(urlStr) {
  const m = String(urlStr || "").match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+):?(\d+)?\/(.+)$/);
  if (!m) throw new Error("Could not parse DATABASE_URL");
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    port: Number(m[4] || 3306),
    database: m[5],
  };
}

/**
 * Checks whether a YouTube video is publicly available via the oEmbed endpoint.
 * Returns true (available), false (definitively unavailable), or null (network error / unknown).
 */
async function checkYouTubeOEmbed(videoId) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), 4000);
    const url = `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${encodeURIComponent(videoId)}&format=json`;
    https
      .get(url, (res) => {
        clearTimeout(timeoutId);
        res.resume(); // consume body to free socket
        if (res.statusCode === 200) resolve(true);
        else if (res.statusCode >= 400 && res.statusCode < 500) resolve(false);
        else resolve(null);
      })
      .on("error", () => {
        clearTimeout(timeoutId);
        resolve(null);
      });
  });
}

/**
 * Probes the HQ YouTube thumbnail endpoint.
 * hqdefault.jpg returns 404 for unavailable/private/deleted videos,
 * while lower-quality variants can return generic placeholder 200s.
 * Returns true (available), false (definitively unavailable), or null (network error / unknown).
 */
async function checkYouTubeHqThumbnail(videoId) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), 4000);
    const url = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
    https
      .get(url, (res) => {
        clearTimeout(timeoutId);
        res.resume(); // consume body to free socket
        if (res.statusCode === 200) resolve(true);
        else if (res.statusCode >= 400 && res.statusCode < 500) resolve(false);
        else resolve(null);
      })
      .on("error", () => {
        clearTimeout(timeoutId);
        resolve(null);
      });
  });
}

/**
 * Checks all published magazine articles and deletes any whose YouTube video
 * is definitively no longer available. Run in parallel for speed.
 */
async function pruneStaleArticles(conn) {
  const [rows] = await conn.query(
    "SELECT id, slug, video_id FROM magazine_articles WHERE status = 'published'",
  );
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const checks = await Promise.allSettled(
    rows.map(async (row) => ({
      id: row.id,
      slug: String(row.slug || ""),
      videoId: String(row.video_id || ""),
      available: await checkYouTubeOEmbed(String(row.video_id || "")),
    })),
  );

  const toDelete = checks
    .filter((r) => r.status === "fulfilled" && r.value.available === false)
    .map((r) => r.value);

  for (const art of toDelete) {
    await conn.execute("DELETE FROM magazine_articles WHERE id = ?", [art.id]);
    console.error(
      JSON.stringify({ event: "pruned-stale-article", slug: art.slug, videoId: art.videoId }),
    );
  }
  return toDelete.length;
}

async function getPlayableCandidates(conn, limit) {
  const [videoColumns] = await conn.query("SHOW COLUMNS FROM videos");
  const colSet = new Set(videoColumns.map((c) => String(c.Field || "").trim()));

  const artistExpr = colSet.has("parsedArtist")
    ? "COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown artist')"
    : "'Unknown artist'";
  const trackExpr = colSet.has("parsedTrack")
    ? "COALESCE(NULLIF(TRIM(v.parsedTrack), ''), NULLIF(TRIM(v.title), ''), 'Unknown track')"
    : "COALESCE(NULLIF(TRIM(v.title), ''), 'Unknown track')";
  const genreExpr = colSet.has("genre")
    ? "COALESCE(NULLIF(TRIM(v.genre), ''), 'Rock / Metal')"
    : "'Rock / Metal'";

  const sql = `
    SELECT
      v.videoId AS videoId,
      ${artistExpr} AS artist,
      ${trackExpr} AS track,
      ${genreExpr} AS genre,
      v.id AS internalId,
      COALESCE(v.favourited, 0) AS favourited
    FROM videos v
    INNER JOIN (SELECT DISTINCT sv.video_id FROM site_videos sv WHERE sv.status = 'available') sv_avail ON sv_avail.video_id = v.id
    WHERE v.videoId IS NOT NULL
    ORDER BY COALESCE(v.favourited, 0) DESC, v.id DESC
    LIMIT ?
  `;

  const [rows] = await conn.query(sql, [limit]);
  return rows
    .map((r) => ({
      videoId: String(r.videoId || "").trim(),
      artist: String(r.artist || "Unknown artist").trim(),
      track: String(r.track || "Unknown track").trim(),
      genre: String(r.genre || "Rock / Metal").trim(),
      favourited: Number(r.favourited || 0),
      internalId: Number(r.internalId || 0),
    }))
    .filter((r) => r.videoId.length === 11 && r.artist.length > 1);
}

function tokenizeArtist(artist) {
  return String(artist || "")
    .toLowerCase()
    .replace(/[()\[\]{}'".,!?/:;|]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !["the", "and", "feat", "with", "band"].includes(t));
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesWord(haystack, needle) {
  const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
  return re.test(haystack);
}

function scoreNewsForVideo(news, video) {
  const text = `${news.title} ${news.summary}`.toLowerCase();
  const artistTokens = tokenizeArtist(video.artist);
  if (artistTokens.length === 0) return -1;

  let tokenHits = 0;
  for (const token of artistTokens) {
    if (includesWord(text, token)) tokenHits += 1;
  }

  const artistCoverage = tokenHits / artistTokens.length;
  if (artistCoverage < 0.5) return -1;

  const trackTokens = tokenizeArtist(video.track);
  let trackHits = 0;
  for (const token of trackTokens) {
    if (includesWord(text, token)) trackHits += 1;
  }

  const freshnessHours = Math.max(0, (Date.now() - news.publishedAt.getTime()) / 36e5);
  const freshnessScore = Math.max(0, 24 - freshnessHours);

  return Math.round(artistCoverage * 120 + Math.min(trackHits, 3) * 10 + freshnessScore + Math.min(video.favourited, 30));
}

function toSlug(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildArticleSlug(video, news) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hash = crypto.createHash("sha1").update(String(news.link)).digest("hex").slice(0, 6);
  return `${toSlug(video.artist)}-${toSlug(video.track)}-${day}-${hash}`;
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    return { usedSources: [], usedVideoIds: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      usedSources: Array.isArray(parsed.usedSources) ? parsed.usedSources : [],
      usedVideoIds: Array.isArray(parsed.usedVideoIds) ? parsed.usedVideoIds : [],
    };
  } catch {
    return { usedSources: [], usedVideoIds: [] };
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function groqRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: "api.groq.com",
        path: "/openai/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": payload.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Failed to parse model response: ${data.slice(0, 260)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const SYSTEM_PROMPT = `You are the staff writer for YehThatRocks. You have strong opinions, zero patience for mediocrity, and you write like you mean it.

Your voice is modelled on the aggressive, first-person, contempt-for-the-obvious style of early internet rants: direct address to the reader, declarative sentences that brook no argument, rhetorical questions used as attacks, hyperbolic confidence delivered deadpan, and genuine fury at anything that wastes your time. You are not a PR mouthpiece. You are not balanced. You have a point of view and you are going to make the reader feel stupid for not already agreeing with it.

You are writing a full-length music feature. The news item is only a HOOK for the opening sentence or two. Everything after that is your take on the TRACK and the ARTIST.

VOICE RULES:
- Write in first person where it lands harder. Use "I" when making a personal judgement call.
- Address the reader directly when you want to make a point land. "You", "your", "sit down."
- State opinions as facts. Do not qualify them. "This riff is better than anything released this decade" is a sentence. "This riff is arguably one of the better ones" is a waste of everyone's time.
- Use contempt sparingly but precisely. Reserve it for the things that actually deserve it: lazy production, cowardly lyrics, bands that play it safe.
- Rhetorical questions are weapons. Use them to puncture something before you explain why it collapses.
- Paragraph length: 4-6 sentences. No thin one-liners masquerading as paragraphs.
- Go deep on the music: riff construction, vocal delivery, drum work, production decisions, dynamics, how this track fits in the artist's body of work.
- Short declarative sentences. Hit hard. Move on.
- No em dashes.
- No hedging: never write arguably, perhaps, maybe, potentially, in many ways, seems to, appears to.
- Never use the pattern: not X, it's Y.
- Never copy source phrasing.
- Do not invent specific facts (dates, chart positions, lineup details). Write about the music as you hear it.

COPYRIGHT RULES:
- The news item supplies the hook only. Do not summarise it.
- No direct quotes or close paraphrases from any source.
- Maximum eight consecutive words of overlap with any source.

OUTPUT JSON ONLY:
{
  "title": "Artist - Track: Punchy, opinionated headline",
  "kicker": "Genre label",
  "deck": "1-2 sentence argument that takes a hard position",
  "body": [
    {"type":"p","text":"..."},
    {"type":"h2","text":"..."}
  ],
  "seoDescription": "150-200 char description",
  "seoKeywords": "comma separated keywords"
}

The body must contain 10-14 blocks. Use 3-4 h2 headings. Each p block must be a full paragraph of 4-6 sentences. End with a paragraph that tells readers exactly where to find this track on YehThatRocks.`;

function buildUserPrompt(video, news) {
  return [
    `Track context:`,
    `Artist: ${video.artist}`,
    `Track: ${video.track}`,
    `Genre: ${video.genre}`,
    `Video ID: ${video.videoId}`,
    "",
    "Use these source facts:",
    `Source publication: ${news.source}`,
    `Source headline: ${news.title}`,
    `Source URL: ${news.link}`,
    `Source published at: ${news.publishedAt.toISOString()}`,
    `Source summary: ${news.summary || "No summary available."}`,
    "",
    "Write one full article in the required JSON format.",
  ].join("\n");
}

function normalizeBlocks(body) {
  if (!Array.isArray(body)) return [];
  return body
    .map((block) => ({
      type: block?.type === "h2" || block?.type === "quote" ? block.type : "p",
      text: String(block?.text || "").replace(/[\u2014\u2013]/g, "-").trim(),
      attribution: block?.attribution ? String(block.attribution).trim() : undefined,
    }))
    .filter((block) => block.text.length > 0);
}

function sanitizeText(input) {
  return String(input || "")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function validateArticleShape(article) {
  const required = ["title", "kicker", "deck", "body", "seoDescription", "seoKeywords"];
  for (const field of required) {
    if (!article[field]) {
      throw new Error(`Generated article missing required field: ${field}`);
    }
  }

  const blocks = normalizeBlocks(article.body);
  if (blocks.length < 10) {
    throw new Error("Generated body is too short (need at least 10 blocks)");
  }

  const title = sanitizeText(article.title);
  const kicker = sanitizeText(article.kicker);
  const deck = sanitizeText(article.deck);
  const seoDescription = sanitizeText(article.seoDescription);
  const seoKeywords = sanitizeText(article.seoKeywords);
  const combined = [title, deck, ...blocks.map((b) => b.text)].join("\n");
  if (/[\u2014\u2013]/.test(combined)) {
    throw new Error("Generated article contains em/en dashes");
  }
  if (/\bnot\b[^\n.!?]{0,100}\bit'?s\b/i.test(combined)) {
    throw new Error("Generated article uses forbidden 'not X it's Y' construction");
  }

  return {
    title,
    kicker,
    deck,
    body: blocks,
    seoDescription,
    seoKeywords,
  };
}

async function generateArticle({ apiKey, model, video, news }) {
  const completion = await groqRequest(apiKey, {
    model,
    temperature: 0.7,
    max_tokens: 4000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(video, news) },
    ],
  });

  if (completion.error) {
    throw new Error(`Model API error: ${JSON.stringify(completion.error)}`);
  }

  const raw = completion?.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("Model response was empty");
  }

  const jsonText = String(raw)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Failed to parse model JSON output: ${jsonText.slice(0, 280)}`);
  }

  return validateArticleShape(parsed);
}

async function generateArticleWithRetries({ apiKey, model, video, news, maxAttempts }) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await generateArticle({ apiKey, model, video, news });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Generation failed after retries");
}

async function saveArticle(conn, slug, video, article) {
  const [existing] = await conn.execute("SELECT id FROM magazine_articles WHERE slug = ? LIMIT 1", [slug]);
  if (Array.isArray(existing) && existing.length > 0) {
    await conn.execute(
      `UPDATE magazine_articles SET
         title=?, kicker=?, deck=?, artist=?, track_name=?, genre=?,
         video_id=?, body=?, seo_description=?, seo_keywords=?, status='published',
         published_at=NOW(3), updated_at=NOW(3)
       WHERE slug=?`,
      [
        article.title,
        article.kicker,
        article.deck,
        video.artist,
        video.track,
        video.genre,
        video.videoId,
        JSON.stringify(article.body),
        article.seoDescription,
        article.seoKeywords,
        slug,
      ],
    );
    return "updated";
  }

  await conn.execute(
    `INSERT INTO magazine_articles
      (slug, title, kicker, deck, artist, track_name, genre, video_id, body, seo_description, seo_keywords, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', NOW(3))`,
    [
      slug,
      article.title,
      article.kicker,
      article.deck,
      video.artist,
      video.track,
      video.genre,
      video.videoId,
      JSON.stringify(article.body),
      article.seoDescription,
      article.seoKeywords,
    ],
  );
  return "inserted";
}

async function run() {
  loadEnv();

  const args = parseArgs(process.argv);
  const dryRun = Boolean(args["dry-run"]);
  const count = toInt(args.count ?? process.env.MAGAZINE_DAILY_COUNT ?? "3", 3, 1, 10);
  const newsWindowHours = toInt(args["news-window-hours"] ?? process.env.MAGAZINE_NEWS_WINDOW_HOURS ?? "72", 72, 12, 336);
  const poolLimit = toInt(args["candidate-pool"] ?? process.env.MAGAZINE_CANDIDATE_POOL ?? "2000", 2000, 200, 10000);
  const statePath = path.resolve(process.cwd(), String(process.env.MAGAZINE_AUTOGEN_STATE_PATH || "logs/magazine-autogen-state.json"));
  const sourceDedupeDays = toInt(args["source-dedupe-days"] ?? process.env.MAGAZINE_SOURCE_DEDUPE_DAYS ?? "14", 14, 1, 90);
  const maxAttempts = toInt(args["max-attempts"] ?? process.env.MAGAZINE_AUTOGEN_MAX_ATTEMPTS ?? "3", 3, 1, 6);

  const groqApiKey = process.env.GROQ_API_KEY?.trim() || "";
  const writerModel = String(args.model || "").trim() || process.env.MAGAZINE_WRITER_MODEL?.trim() || "openai/gpt-oss-120b";
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";

  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY is required");
  }
  if (!databaseUrl && !dryRun) {
    throw new Error("DATABASE_URL is required unless --dry-run is set");
  }

  const news = await fetchNewsItems(newsWindowHours);
  if (news.length === 0) {
    throw new Error("No recent news items found from configured feeds");
  }

  const state = readState(statePath);
  const now = Date.now();
  const dedupeCutoff = now - sourceDedupeDays * 24 * 60 * 60 * 1000;
  const recentUsed = new Set(
    state.usedSources
      .filter((entry) => Number.isFinite(Date.parse(entry.usedAt)) && Date.parse(entry.usedAt) >= dedupeCutoff)
      .map((entry) => String(entry.url || "").trim().toLowerCase()),
  );
  const recentUsedVideoIds = new Set(
    (state.usedVideoIds || [])
      .filter((entry) => Number.isFinite(Date.parse(entry.usedAt)) && Date.parse(entry.usedAt) >= dedupeCutoff)
      .map((entry) => String(entry.videoId || "").trim()),
  );

  const dbConf = parseDatabaseUrl(databaseUrl || "mysql://root:root@127.0.0.1:3306/yeh_live");
  const conn = await mysql.createConnection(dbConf);

  try {
    // Prune existing articles whose YouTube videos are no longer available
    if (!dryRun) {
      await pruneStaleArticles(conn);
    }

    const videos = await getPlayableCandidates(conn, poolLimit);
    if (videos.length === 0) {
      throw new Error("No playable video candidates found");
    }

    const candidates = [];
    for (const item of news) {
      const key = String(item.link || "").trim().toLowerCase();
      if (!key || recentUsed.has(key)) continue;

      let best = null;
      let bestScore = -1;
      for (const video of videos) {
        const score = scoreNewsForVideo(item, video);
        if (score > bestScore) {
          bestScore = score;
          best = video;
        }
      }

      if (best && bestScore >= 75) {
        candidates.push({ news: item, video: best, score: bestScore });
      }
    }

    if (candidates.length === 0) {
      throw new Error("No suitable news-to-track matches found");
    }

    candidates.sort((a, b) => b.score - a.score);

    const selected = [];
    const usedVideoIdsThisRun = new Set();
    for (const candidate of candidates) {
      if (selected.length >= count) break;
      if (recentUsedVideoIds.has(candidate.video.videoId)) continue;
      if (usedVideoIdsThisRun.has(candidate.video.videoId)) continue;
      selected.push(candidate);
      usedVideoIdsThisRun.add(candidate.video.videoId);
    }

    const results = [];
    for (const selection of selected) {
      // Pre-flight: confirm the video is still available on YouTube before spending AI tokens
      const videoAvailable = await checkYouTubeOEmbed(selection.video.videoId);
      if (videoAvailable === false) {
        console.error(
          JSON.stringify({
            event: "skipped-unavailable-video",
            videoId: selection.video.videoId,
            artist: selection.video.artist,
          }),
        );
        continue;
      }

      // Hard gate: require a positive HQ thumbnail probe before generation.
      // This avoids low-quality placeholder false-positives.
      const hqThumbnailAvailable = await checkYouTubeHqThumbnail(selection.video.videoId);
      if (hqThumbnailAvailable !== true) {
        console.error(
          JSON.stringify({
            event: hqThumbnailAvailable === false ? "skipped-unavailable-hq-thumbnail" : "skipped-unverified-hq-thumbnail",
            videoId: selection.video.videoId,
            artist: selection.video.artist,
          }),
        );
        continue;
      }

      const slug = buildArticleSlug(selection.video, selection.news);
      const article = await generateArticleWithRetries({
        apiKey: groqApiKey,
        model: writerModel,
        video: selection.video,
        news: selection.news,
        maxAttempts,
      });

      let dbAction = "dry-run";
      if (!dryRun) {
        dbAction = await saveArticle(conn, slug, selection.video, article);
      }

      results.push({
        slug,
        dbAction,
        model: writerModel,
        source: selection.news.source,
        sourceTitle: selection.news.title,
        sourceUrl: selection.news.link,
        artist: selection.video.artist,
        track: selection.video.track,
        videoId: selection.video.videoId,
        title: article.title,
      });
    }

    if (!dryRun) {
      const now2 = new Date().toISOString();
      const usedSources = [
        ...state.usedSources.filter((entry) => Number.isFinite(Date.parse(entry.usedAt)) && Date.parse(entry.usedAt) >= dedupeCutoff),
        ...results.map((r) => ({ url: r.sourceUrl, usedAt: now2, slug: r.slug })),
      ];
      const usedVideoIds = [
        ...(state.usedVideoIds || []).filter((entry) => Number.isFinite(Date.parse(entry.usedAt)) && Date.parse(entry.usedAt) >= dedupeCutoff),
        ...results.map((r) => ({ videoId: r.videoId, usedAt: now2, slug: r.slug })),
      ];
      writeState(statePath, { usedSources, usedVideoIds });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun,
          writerModel,
          requestedCount: count,
          generatedCount: results.length,
          candidatesScored: candidates.length,
          statePath,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    await conn.end();
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
