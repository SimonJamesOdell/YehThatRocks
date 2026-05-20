#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const mysql = require("mysql2/promise");
const { maybeShareMagazineArticle } = require("./lib/facebook-group-magazine-share");

const NEWS_FEEDS = [
  { name: "BBC Entertainment", url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml" },
  { name: "The Guardian Music", url: "https://www.theguardian.com/music/rss" },
  { name: "NME", url: "https://www.nme.com/news/music/feed" },
  { name: "Loudwire", url: "https://loudwire.com/feed/" },
  { name: "Metal Injection", url: "https://metalinjection.net/feed" },
  { name: "Blabbermouth", url: "https://blabbermouth.net/feed" },
  { name: "Pitchfork", url: "https://pitchfork.com/feed/reviews/" },
  { name: "Metal Hammer", url: "https://www.metalhammer.com/feed/" },
  { name: "Kerrang!", url: "https://www.kerrang.com/feed" },
  { name: "AllMusic", url: "https://www.allmusic.com/rss/new-releases" },
  { name: "Brooklyn Vegan", url: "https://www.brooklynvegan.com/feed/" },
  { name: "Consequence", url: "https://consequence.net/feed" },
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
 * Probes the maxresdefault YouTube thumbnail endpoint.
 * This is the exact image the article page displays, so we gate on it directly.
 * maxresdefault.jpg returns 404 for videos that were never uploaded in HD or are unavailable,
 * while hqdefault can return placeholder 200s for those same videos.
 * Returns true (available), false (definitively unavailable), or null (network error / unknown).
 */
async function checkYouTubeMaxresThumbnail(videoId) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), 4000);
    const url = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`;
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

async function getPublishedArticleVideoIds(conn) {
  const [rows] = await conn.query(
    "SELECT DISTINCT video_id AS videoId FROM magazine_articles WHERE status = 'published' AND video_id IS NOT NULL",
  );

  return new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row.videoId || "").trim())
      .filter((videoId) => videoId.length === 11),
  );
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

async function buildArticleSlug(conn, video) {
  const artistSlug = toSlug(video.artist);
  const trackSlug = toSlug(video.track);
  const baseSlug = [artistSlug, trackSlug].filter(Boolean).join("-") || "magazine-article";

  let candidateSlug = baseSlug;
  let suffix = 2;

  while (true) {
    const [existing] = await conn.execute("SELECT id FROM magazine_articles WHERE slug = ? LIMIT 1", [candidateSlug]);
    if (!Array.isArray(existing) || existing.length === 0) {
      return candidateSlug;
    }
    candidateSlug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
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

const VOICE_RULES = `VOICE RULES:
- Write in first person where it lands harder. Use "I" when making a personal judgement call.
- Address the reader directly when you want to make a point land. "You", "your", "sit down."
- State opinions as facts. Do not qualify them. "This riff is better than anything released this decade" is a sentence. "This riff is arguably one of the better ones" is a waste of everyone's time.
- Use contempt sparingly but precisely. Reserve it for the things that actually deserve it: lazy production, cowardly lyrics, bands that play it safe.
- Rhetorical questions are weapons. Use them to puncture something before you explain why it collapses.
- Paragraph length: 4-6 sentences. No thin one-liners masquerading as paragraphs.
- Go deep on the music: riff construction, vocal delivery, drum work, production decisions, dynamics.
- Short declarative sentences. Hit hard. Move on.
- No em dashes.
- No hedging: never write arguably, perhaps, maybe, potentially, in many ways, seems to, appears to.
- Never use the pattern: not X, it's Y.
- Never copy source phrasing.
- Do not invent specific facts. If band member names are provided, use them. Do not invent members if none are provided.
- Do not add reader instructions about where/how to watch the track (no "click", "navigate", or "find it on").
- Do not claim downloads or formats unless explicitly provided in input context (never invent FLAC/download availability).`;

const SYSTEM_PROMPT = `You are the staff writer for YehThatRocks. You have strong opinions, zero patience for mediocrity, and you write like you mean it.

Your voice is modelled on the aggressive, first-person, contempt-for-the-obvious style of early internet rants: direct address to the reader, declarative sentences that brook no argument, rhetorical questions used as attacks, hyperbolic confidence delivered deadpan, and genuine fury at anything that wastes your time. You are not a PR mouthpiece. You are not balanced. You have a point of view and you are going to make the reader feel stupid for not already agreeing with it.

You are writing a full-length music feature. The news item is only a HOOK for the opening sentence or two. Everything after that is your take on the TRACK and the ARTIST.

${VOICE_RULES}

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

The body must contain 10-14 blocks. Use 3-4 h2 headings. Each p block must be a full paragraph of 4-6 sentences. Do not add closing "how to watch" instructions.`;

/**
 * Fetch current band members from MusicBrainz for a given artist name.
 * Returns an array of { name, roles } objects, or an empty array on failure.
 */
async function fetchBandMembers(artistName) {
  try {
    const searchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&limit=5&fmt=json`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "YehThatRocksMagazineBot/1.0 (https://yehthatrocks.com)",
        "Accept": "application/json",
      },
    });
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();

    const artists = searchData?.artists || [];
    // Pick best match that is a Group/band with a high confidence score
    const match = artists.find((a) => a.type === "Group" && (a.score ?? 0) >= 80);
    if (!match) return [];

    // Respect MusicBrainz rate limit: max 1 req/sec
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const relUrl = `https://musicbrainz.org/ws/2/artist/${match.id}?inc=artist-rels&fmt=json`;
    const relRes = await fetch(relUrl, {
      headers: {
        "User-Agent": "YehThatRocksMagazineBot/1.0 (https://yehthatrocks.com)",
        "Accept": "application/json",
      },
    });
    if (!relRes.ok) return [];
    const relData = await relRes.json();

    const relations = relData?.relations || [];
    const members = [];
    // Matches characters outside Latin/Latin-Extended/common punctuation ranges.
    // Filters out CJK, Cyrillic, Arabic, and other non-Latin scripts that English
    // readers cannot read, which MusicBrainz returns in native script.
    const nonLatinRe = /[^\u0000-\u024F\s'\-.,]/;
    for (const rel of relations) {
      // "member of band" from the band's view: direction is "backward", rel.artist is the member
      if (rel.type !== "member of band" || rel.direction !== "backward") continue;
      if (rel.ended === true || rel.end) continue; // skip past members
      const memberName = rel.artist?.name;
      if (!memberName) continue;
      // Skip names that cannot be read by English-speaking users
      if (nonLatinRe.test(memberName)) continue;
      const roles = Array.isArray(rel.attributes) ? rel.attributes : [];
      members.push({ name: memberName, roles });
    }
    return members;
  } catch {
    return [];
  }
}

function buildUserPrompt(video, news, members) {
  const lines = [
    `Track context:`,
    `Artist: ${video.artist}`,
    `Track: ${video.track}`,
    `Genre: ${video.genre}`,
    `Video ID: ${video.videoId}`,
  ];

  if (members && members.length > 0) {
    lines.push("");
    lines.push("Band lineup (use these real names when writing about instruments or roles):");
    for (const m of members) {
      const roleStr = m.roles.length > 0 ? ` (${m.roles.join(", ")})` : "";
      lines.push(`- ${m.name}${roleStr}`);
    }
  }

  lines.push(
    "",
    "Use these source facts:",
    `Source publication: ${news.source}`,
    `Source headline: ${news.title}`,
    `Source URL: ${news.link}`,
    `Source published at: ${news.publishedAt.toISOString()}`,
    `Source summary: ${news.summary || "No summary available."}`,
    "",
    "Write one full article in the required JSON format.",
  );

  return lines.join("\n");
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

function isRedundantClosingCta(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;

  const watchNavPattern = /(yehthatrocks|video id|stream|watch|navigate|click|find\s+[^.]{0,80}\s+on\s+yehthatrocks)/i;
  const downloadPattern = /(download|flac|high[- ]resolution|high[- ]res)/i;
  return watchNavPattern.test(t) || downloadPattern.test(t);
}

function stripRedundantClosingCtaBlock(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!block || block.type !== "p") continue;
    if (!isRedundantClosingCta(block.text)) return blocks;
    return [...blocks.slice(0, i), ...blocks.slice(i + 1)];
  }

  return blocks;
}

function validateArticleShape(article) {
  const required = ["title", "kicker", "deck", "body", "seoDescription", "seoKeywords"];
  for (const field of required) {
    if (!article[field]) {
      throw new Error(`Generated article missing required field: ${field}`);
    }
  }

  const blocks = stripRedundantClosingCtaBlock(normalizeBlocks(article.body));
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

async function generateArticle({ apiKey, model, video, news, members }) {
  const completion = await groqRequest(apiKey, {
    model,
    temperature: 0.7,
    max_tokens: 4000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(video, news, members) },
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

// System prompts for different article modes
const BAND_HISTORY_SYSTEM_PROMPT = `You are the staff writer for YehThatRocks writing a historical deep-dive on a rock/metal band.

Your voice is aggressive, opinionated, and first-person. You're writing about the band's formation, key members, major albums, and impact on the genre. You have strong takes on their evolution and don't shy away from criticism.

${VOICE_RULES}

OUTPUT JSON ONLY:
{
  "title": "Band Name: Historical Deep-Dive Headline (e.g., 'Metallica: The Kings Who Made Thrash Respectable')",
  "kicker": "Band name and genre",
  "deck": "1-2 sentence opinionated take on why this band matters",
  "body": [
    {"type":"p","text":"..."},
    {"type":"h2","text":"Formation and Early Days"},
    ...
  ],
  "seoDescription": "150-200 char description",
  "seoKeywords": "band name, genre, history keywords"
}

The body must contain 10-14 blocks covering: formation/early days, key lineup evolution, major album era, influence/legacy, and current status. Each section should have 1-2 paragraphs of 4-6 sentences. Do not add closing "how to watch" instructions.`;

const CURATED_PICKS_SYSTEM_PROMPT = `You are the staff writer for YehThatRocks creating a curated listicle: "Top Picks in [GENRE]" or "[THEME] Essential Tracks".

Your voice is authoritative but opinionated. You're showcasing 4-6 essential tracks in this genre/theme, explaining why each matters and what makes it stand out. This isn't a "best of" ranked list—it's your curated selection with reasoning.

${VOICE_RULES}

OUTPUT JSON ONLY:
{
  "title": "[Genre/Theme]: [Listicle Headline] (e.g., 'Thrash Metal Essentials: 5 Tracks That Defined the Genre')",
  "kicker": "Genre or theme label",
  "deck": "1-2 sentence hook on why these tracks matter",
  "body": [
    {"type":"p","text":"Opening paragraph introducing the theme..."},
    {"type":"h2","text":"Artist 1 - Track Name"},
    {"type":"p","text":"2-3 paragraphs (4-6 sentences each) explaining this track's significance..."},
    {"type":"h2","text":"Artist 2 - Track Name"},
    ...
  ],
  "seoDescription": "150-200 char description",
  "seoKeywords": "genre, theme, artist names keywords"
}

The body must contain 14-18 blocks. Include 4-6 artist/track sections (h2 headings with 1-2 paragraphs each). Do not add closing "how to watch" instructions.`;

async function generateArticleWithRetries({ apiKey, model, video, news, members, maxAttempts, mode, ...otherArgs }) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (mode === "band-history") {
        return await generateBandHistoryArticle({ apiKey, model, members, ...otherArgs });
      } else if (mode === "curated-picks") {
        return await generateCuratedPicksArticle({ apiKey, model, ...otherArgs });
      } else {
        // Default: news mode
        return await generateArticle({ apiKey, model, video, news, members });
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Generation failed after retries");
}

async function generateBandHistoryArticle({ apiKey, model, artist, videoIds, members }) {
  const lines = [
    `Band: ${artist}`,
    `Known videos in our catalog: ${videoIds.length}`,
  ];
  
  if (members && members.length > 0) {
    lines.push("");
    lines.push("Notable members (from MusicBrainz):");
    for (const m of members) {
      const roleStr = m.roles.length > 0 ? ` (${m.roles.join(", ")})` : "";
      lines.push(`- ${m.name}${roleStr}`);
    }
  }
  
  lines.push(
    "",
    "Write a comprehensive band history article covering formation, key eras, lineup evolution, influence, and current status. Keep the length similar to our news-driven articles (10-14 body blocks). Make it opinionated and engaging."
  );

  const completion = await groqRequest(apiKey, {
    model,
    temperature: 0.7,
    max_tokens: 4000,
    messages: [
      { role: "system", content: BAND_HISTORY_SYSTEM_PROMPT },
      { role: "user", content: lines.join("\n") },
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
    throw new Error(`Failed to parse band history JSON: ${jsonText.slice(0, 280)}`);
  }

  return validateArticleShape(parsed);
}

async function generateCuratedPicksArticle({ apiKey, model, genre, theme, artists, videoIds }) {
  const lines = [
    `Genre/Theme: ${theme || genre}`,
    `Featured artists: ${artists.map(a => a.name).join(", ")}`,
    `Total videos available: ${videoIds.length}`,
  ];
  
  lines.push(
    "",
    "Write a curated listicle showcasing the best tracks in this genre/theme. Each artist gets 1-2 paragraphs explaining their significance and style. This is your opinionated curation, not a ranked countdown. Keep total body to 14-18 blocks (4-6 artist sections with 1-2 paragraphs each). Do not add a final paragraph about where/how to watch or download."
  );

  const completion = await groqRequest(apiKey, {
    model,
    temperature: 0.7,
    max_tokens: 4500,
    messages: [
      { role: "system", content: CURATED_PICKS_SYSTEM_PROMPT },
      { role: "user", content: lines.join("\n") },
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
    throw new Error(`Failed to parse curated picks JSON: ${jsonText.slice(0, 280)}`);
  }

  return validateArticleShape(parsed);
}

async function getArtistsByGenre(conn, genre, limit = 50) {
  try {
    // Genre info is on Artist model, but Video doesn't have genre.
    // For now, just get popular artists with videos as a fallback to genre selection.
    // In the future, this could query Artist table directly if needed.
    const [rows] = await conn.query(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown artist') AS artist, 
              COUNT(v.id) as video_count,
              MAX(COALESCE(v.favourited, 0)) as max_favourites
       FROM videos v
       WHERE v.videoId IS NOT NULL AND v.parsedArtist IS NOT NULL AND TRIM(v.parsedArtist) != ''
       GROUP BY v.parsedArtist
       ORDER BY video_count DESC, max_favourites DESC
       LIMIT ?`,
      [limit]
    );
    
    return (Array.isArray(rows) ? rows : []).map(r => ({
      name: String(r.artist || "Unknown").trim(),
      videoCount: Number(r.video_count || 0),
    })).filter(r => r.name.length > 1 && r.name !== "Unknown artist" && r.videoCount > 0);
  } catch (err) {
    console.error("getArtistsByGenre error:", err instanceof Error ? err.message : err);
    return [];
  }
}

async function getVideosByArtist(conn, artist) {
  try {
    const [rows] = await conn.query(
      "SELECT DISTINCT v.videoId, v.id FROM videos v WHERE (v.parsedArtist = ? OR TRIM(v.parsedArtist) = ? OR LOWER(v.parsedArtist) = LOWER(?)) AND v.videoId IS NOT NULL AND v.videoId != '' LIMIT 100",
      [artist, artist, artist]
    );
    return (Array.isArray(rows) ? rows : []).map(r => String(r.videoId || "").trim()).filter(vid => vid.length === 11);
  } catch (err) {
    console.error(`getVideosByArtist(${artist}) error:`, err instanceof Error ? err.message : err);
    return [];
  }
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
  const mode = String(args.mode || "").trim() || "news"; // 'news', 'band-history', or 'curated-picks'
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

  // For news mode, fetch news items. For other modes, we'll use different logic.
  let news = [];
  if (mode === "news") {
    news = await fetchNewsItems(newsWindowHours);
    if (news.length === 0) {
      throw new Error("No recent news items found from configured feeds");
    }
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

    const publishedVideoIds = await getPublishedArticleVideoIds(conn);
    const videos = await getPlayableCandidates(conn, poolLimit);
    if (videos.length === 0) {
      throw new Error("No playable video candidates found");
    }

    let selected = [];
    let candidatesScored = 0;

    // CONTENT MODE: News-based articles
    if (mode === "news") {
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

      candidatesScored = candidates.length;
      candidates.sort((a, b) => b.score - a.score);

      const usedVideoIdsThisRun = new Set();
      for (const candidate of candidates) {
        if (selected.length >= count) break;
        if (recentUsedVideoIds.has(candidate.video.videoId)) continue;
        if (usedVideoIdsThisRun.has(candidate.video.videoId)) continue;
        if (publishedVideoIds.has(candidate.video.videoId)) {
          console.error(
            JSON.stringify({
              event: "skipped-duplicate-published-article",
              videoId: candidate.video.videoId,
              artist: candidate.video.artist,
              track: candidate.video.track,
            }),
          );
          continue;
        }

        // Check availability: continue to next candidate if this one fails
        const videoAvailable = await checkYouTubeOEmbed(candidate.video.videoId);
        if (videoAvailable === false) {
          console.error(
            JSON.stringify({
              event: "skipped-unavailable-video",
              videoId: candidate.video.videoId,
              artist: candidate.video.artist,
            }),
          );
          continue; // Try next candidate instead of aborting
        }

        // Check maxres thumbnail: continue to next candidate if missing
        const maxresThumbnailAvailable = await checkYouTubeMaxresThumbnail(candidate.video.videoId);
        if (maxresThumbnailAvailable !== true) {
          console.error(
            JSON.stringify({
              event: maxresThumbnailAvailable === false ? "skipped-unavailable-maxres-thumbnail" : "skipped-unverified-maxres-thumbnail",
              videoId: candidate.video.videoId,
              artist: candidate.video.artist,
            }),
          );
          continue; // Try next candidate instead of aborting
        }

        selected.push({
          type: "news",
          video: candidate.video,
          news: candidate.news,
        });
        usedVideoIdsThisRun.add(candidate.video.videoId);
      }

      if (selected.length === 0) {
        throw new Error("All news candidates failed quality gates. No articles generated.");
      }
    }

    // CONTENT MODE: Band history articles
    else if (mode === "band-history") {
      const genres = ["Thrash Metal", "Heavy Metal", "Death Metal", "Black Metal", "Hard Rock", "Punk", "Post-Punk"];
      const pickedGenres = [];
      for (let i = 0; i < count && i < genres.length; i++) {
        pickedGenres.push(genres[Math.floor(Math.random() * genres.length)]);
      }

      for (const genre of pickedGenres) {
        if (selected.length >= count) break;

        const artists = await getArtistsByGenre(conn, genre, 100);
        console.error(JSON.stringify({ event: "band-history-artists-fetched", genre, count: artists.length, artists: artists.slice(0, 5).map(a => a.name) }));
        if (artists.length === 0) continue;

        // Pick a random artist from the genre
        let artist = null;
        for (let attempts = 0; attempts < 10 && !artist; attempts++) {
          const candidate = artists[Math.floor(Math.random() * artists.length)];
          const videoIds = await getVideosByArtist(conn, candidate.name);
          console.error(JSON.stringify({ event: "band-history-candidate-check", artist: candidate.name, videoCount: videoIds.length, published: publishedVideoIds.has(videoIds[0] || ""), recentlyUsed: recentUsedVideoIds.has(videoIds[0] || "") }));
          if (videoIds.length > 0 && !publishedVideoIds.has(videoIds[0]) && !recentUsedVideoIds.has(videoIds[0])) {
            artist = candidate;
            artist.videoIds = videoIds;
            console.error(JSON.stringify({ event: "band-history-artist-selected", artist: artist.name, videoCount: videoIds.length }));
            break;
          }
        }

        if (!artist) {
          console.error(JSON.stringify({ event: "band-history-no-suitable-artist-found", genre }));
          continue;
        }

        selected.push({
          type: "band-history",
          artist: artist.name,
          videoIds: artist.videoIds,
          genre,
        });
      }

      if (selected.length === 0) {
        throw new Error("Could not find suitable bands for history articles");
      }
    }

    // CONTENT MODE: Curated picks articles
    else if (mode === "curated-picks") {
      const genres = ["Thrash Metal", "Death Metal", "Black Metal", "Heavy Metal", "Hard Rock"];
      const themes = ["Essential", "Underground Gems", "Modern Classics"];

      for (let i = 0; i < count; i++) {
        if (selected.length >= count) break;

        const genre = genres[Math.floor(Math.random() * genres.length)];
        const theme = themes[Math.floor(Math.random() * themes.length)];
        const artists = await getArtistsByGenre(conn, genre, 100);

        if (artists.length < 3) continue;

        // Pick 3-5 random artists from this genre
        const pickedArtists = [];
        const seen = new Set();
        for (let attempts = 0; attempts < 20 && pickedArtists.length < 5; attempts++) {
          const artist = artists[Math.floor(Math.random() * artists.length)];
          if (seen.has(artist.name)) continue;
          seen.add(artist.name);

          const videoIds = await getVideosByArtist(conn, artist.name);
          if (videoIds.length > 0) {
            pickedArtists.push({ ...artist, videoIds });
          }
        }

        if (pickedArtists.length < 3) continue;

        const allVideoIds = pickedArtists.flatMap(a => a.videoIds);
        selected.push({
          type: "curated-picks",
          genre,
          theme,
          artists: pickedArtists.map(a => ({ name: a.name })),
          videoIds: allVideoIds,
        });
      }

      if (selected.length === 0) {
        throw new Error("Could not generate curated picks. Not enough diverse artists found.");
      }
    } else {
      throw new Error(`Unknown mode: ${mode}. Use 'news', 'band-history', or 'curated-picks'.`);
    }

    const results = [];
    for (const selection of selected) {
      try {
        if (selection.type === "news") {
          // NEWS MODE: Generate from news hook + video
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

          const maxresThumbnailAvailable = await checkYouTubeMaxresThumbnail(selection.video.videoId);
          if (maxresThumbnailAvailable !== true) {
            console.error(
              JSON.stringify({
                event: "skipped-unavailable-maxres-thumbnail",
                videoId: selection.video.videoId,
                artist: selection.video.artist,
              }),
            );
            continue;
          }

          const slug = await buildArticleSlug(conn, selection.video);
          const bandMembers = await fetchBandMembers(selection.video.artist);
          
          const article = await generateArticleWithRetries({
            apiKey: groqApiKey,
            model: writerModel,
            video: selection.video,
            news: selection.news,
            members: bandMembers,
            maxAttempts,
          });

          let dbAction = "dry-run";
          let facebookShare = { status: "skipped", reason: "dry-run" };
          if (!dryRun) {
            dbAction = await saveArticle(conn, slug, selection.video, article);
            publishedVideoIds.add(selection.video.videoId);
            try {
              facebookShare = await maybeShareMagazineArticle({
                slug,
                title: article.title,
                artist: selection.video.artist,
                track: selection.video.track,
                genre: selection.video.genre,
                videoId: selection.video.videoId,
              });
            } catch (shareError) {
              facebookShare = {
                status: "error",
                error: shareError instanceof Error ? shareError.message : String(shareError),
              };
            }
          }

          results.push({
            slug,
            dbAction,
            model: writerModel,
            type: "news",
            source: selection.news.source,
            sourceTitle: selection.news.title,
            sourceUrl: selection.news.link,
            artist: selection.video.artist,
            track: selection.video.track,
            videoId: selection.video.videoId,
            title: article.title,
            facebookShare,
          });
        }

        else if (selection.type === "band-history") {
          // BAND HISTORY MODE: Generate biography article
          const bandMembers = await fetchBandMembers(selection.artist);
          
          // Pick first video for slug/preview
          const videoId = selection.videoIds[0];
          
          // For band-history, we need to fetch the video record directly since it might not be in the top candidates
          const [videoRows] = await conn.query(
            "SELECT v.videoId, v.parsedArtist as artist, v.parsedTrack as track, v.title, v.id FROM videos v WHERE v.videoId = ? LIMIT 1",
            [videoId]
          );
          const videoRow = Array.isArray(videoRows) && videoRows.length > 0 ? videoRows[0] : null;
          if (!videoRow) {
            console.error(JSON.stringify({ event: "band-history-video-not-found", videoId }));
            continue;
          }
          
          const video = {
            videoId: videoRow.videoId,
            artist: selection.artist || videoRow.artist || "Unknown",
            track: videoRow.track || videoRow.title || "Unknown",
            genre: "Rock / Metal",
            internalId: videoRow.id,
            favourited: 0,
          };

          // Check video availability
          const videoAvailable = await checkYouTubeOEmbed(videoId);
          if (videoAvailable === false) {
            console.error(JSON.stringify({ event: "band-history-video-unavailable", videoId, artist: selection.artist }));
            continue;
          }

          const maxresThumbnailAvailable = await checkYouTubeMaxresThumbnail(videoId);
          if (maxresThumbnailAvailable !== true) {
            console.error(JSON.stringify({ event: "band-history-no-maxres-thumbnail", videoId, artist: selection.artist }));
            continue;
          }

          const article = await generateArticleWithRetries({
            apiKey: groqApiKey,
            model: writerModel,
            members: bandMembers,
            artist: selection.artist,
            videoIds: selection.videoIds,
            maxAttempts,
            mode: "band-history",
          });

          const slug = await buildArticleSlug(conn, video);
          let dbAction = "dry-run";
          let facebookShare = { status: "skipped", reason: "dry-run" };
          if (!dryRun) {
            dbAction = await saveArticle(conn, slug, video, article);
            publishedVideoIds.add(videoId);
            try {
              facebookShare = await maybeShareMagazineArticle({
                slug,
                title: article.title,
                artist: video.artist,
                track: video.track,
                genre: video.genre,
                videoId,
              });
            } catch (shareError) {
              facebookShare = {
                status: "error",
                error: shareError instanceof Error ? shareError.message : String(shareError),
              };
            }
          }

          results.push({
            slug,
            dbAction,
            model: writerModel,
            type: "band-history",
            artist: selection.artist,
            videoIds: selection.videoIds,
            title: article.title,
            facebookShare,
          });
        }

        else if (selection.type === "curated-picks") {
          // CURATED PICKS MODE: Generate listicle
          const videoId = selection.videoIds[0];
          
          // Fetch video record directly for curated-picks mode
          const [videoRows] = await conn.query(
            "SELECT v.videoId, v.parsedArtist as artist, v.parsedTrack as track, v.title, v.id FROM videos v WHERE v.videoId = ? LIMIT 1",
            [videoId]
          );
          const videoRow = Array.isArray(videoRows) && videoRows.length > 0 ? videoRows[0] : null;
          if (!videoRow) {
            console.error(JSON.stringify({ event: "curated-picks-video-not-found", videoId, genre: selection.genre }));
            continue;
          }
          
          const video = {
            videoId: videoRow.videoId,
            artist: videoRow.artist || "Unknown",
            track: videoRow.track || videoRow.title || "Unknown",
            genre: selection.genre,
            internalId: videoRow.id,
            favourited: 0,
          };

          const videoAvailable = await checkYouTubeOEmbed(videoId);
          if (videoAvailable === false) {
            console.error(JSON.stringify({ event: "curated-picks-video-unavailable", videoId, genre: selection.genre }));
            continue;
          }

          const maxresThumbnailAvailable = await checkYouTubeMaxresThumbnail(videoId);
          if (maxresThumbnailAvailable !== true) {
            console.error(JSON.stringify({ event: "curated-picks-no-maxres-thumbnail", videoId, genre: selection.genre }));
            continue;
          }

          const article = await generateArticleWithRetries({
            apiKey: groqApiKey,
            model: writerModel,
            genre: selection.genre,
            theme: selection.theme,
            artists: selection.artists,
            videoIds: selection.videoIds,
            maxAttempts,
            mode: "curated-picks",
          });

          const slug = await buildArticleSlug(conn, video);
          let dbAction = "dry-run";
          let facebookShare = { status: "skipped", reason: "dry-run" };
          if (!dryRun) {
            dbAction = await saveArticle(conn, slug, video, article);
            publishedVideoIds.add(videoId);
            try {
              facebookShare = await maybeShareMagazineArticle({
                slug,
                title: article.title,
                artist: video.artist,
                track: video.track,
                genre: video.genre,
                videoId,
              });
            } catch (shareError) {
              facebookShare = {
                status: "error",
                error: shareError instanceof Error ? shareError.message : String(shareError),
              };
            }
          }

          results.push({
            slug,
            dbAction,
            model: writerModel,
            type: "curated-picks",
            genre: selection.genre,
            theme: selection.theme,
            artists: selection.artists.map(a => a.name),
            videoIds: selection.videoIds,
            title: article.title,
            facebookShare,
          });
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "article-generation-failed",
            type: selection.type,
            error: err instanceof Error ? err.message : String(err),
            ...(selection.type === "news" && { videoId: selection.video.videoId, artist: selection.video.artist }),
            ...(selection.type === "band-history" && { artist: selection.artist }),
            ...(selection.type === "curated-picks" && { genre: selection.genre }),
          }),
        );
        continue;
      }
    }

    if (!dryRun) {
      const now2 = new Date().toISOString();
      
      // Only track sources and videoIds for news mode articles
      const newsResults = results.filter(r => r.type === "news" || r.source);
      const otherVideoIds = results.filter(r => r.videoId && (r.type === "band-history" || r.type === "curated-picks")).map(r => r.videoIds || []).flat();
      
      const usedSources = [
        ...state.usedSources.filter((entry) => Number.isFinite(Date.parse(entry.usedAt)) && Date.parse(entry.usedAt) >= dedupeCutoff),
        ...newsResults.map((r) => ({ url: r.sourceUrl, usedAt: now2, slug: r.slug })).filter(item => item.url),
      ];
      const usedVideoIds = [
        ...(state.usedVideoIds || []).filter((entry) => Number.isFinite(Date.parse(entry.usedAt)) && Date.parse(entry.usedAt) >= dedupeCutoff),
        ...newsResults.map((r) => ({ videoId: r.videoId, usedAt: now2, slug: r.slug })).filter(item => item.videoId),
        ...otherVideoIds.map((videoId) => ({ videoId, usedAt: now2, slug: "non-news-article" })),
      ];
      writeState(statePath, { usedSources, usedVideoIds });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun,
          writerModel,
          mode,
          requestedCount: count,
          generatedCount: results.length,
          candidatesScored,
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
