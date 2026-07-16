#!/usr/bin/env node
// scripts/generate-magazine-article.js
//
// Generates a magazine article using DeepSeek and inserts it into the database.
//
// Usage:
//   node scripts/generate-magazine-article.js \
//     --artist="Metallica" --track="Enter Sandman" \
//     --videoId="abc123defgh" --genre="Heavy Metal"
//
// Optional flags:
//   --deck="Custom subtitle"   Override the generated deck
//   --dry-run                  Print generated JSON without saving to DB
//   --overwrite                Replace existing article with same slug
//
// Environment:
//   DATABASE_URL          MySQL connection string
//   DEEPSEEK_API_KEY      DeepSeek API key
//   DEEPSEEK_WRITER_MODEL DeepSeek model to use (default: deepseek-chat)

"use strict";

const mysql = require("mysql2/promise");
const https = require("node:https");
const path = require("node:path");
const fs = require("node:fs");
const { maybeShareMagazineArticle } = require("./lib/facebook-group-magazine-share");
const { isRockMetalGenre } = require("./lib/genre-scope");

// ── Args parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (match) {
      args[match[1]] = match[2] ?? true;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const artist = args["artist"];
const track = args["track"];
const videoId = args["videoId"];
const genre = args["genre"];
const deckOverride = typeof args["deck"] === "string" ? args["deck"] : null;
const isDryRun = Boolean(args["dry-run"]);
const overwrite = Boolean(args["overwrite"]);

const { loadEnv } = require("./lib/social-share-utils");
loadEnv();

const ENABLE_MAGAZINE_GENERATION = process.env.ENABLE_MAGAZINE_GENERATION === "1";

if (!ENABLE_MAGAZINE_GENERATION) {
  console.error("Magazine generation is temporarily disabled.");
  process.exit(1);
}

if (!artist || !track || !videoId || !genre) {
  console.error("Usage: node scripts/generate-magazine-article.js --artist=NAME --track=NAME --videoId=ID --genre=NAME");
  console.error("Optional: --deck='...' --dry-run --overwrite");
  process.exit(1);
}

if (!isRockMetalGenre(genre)) {
  console.error(
    JSON.stringify({
      event: "rejected-non-rock-metal-genre",
      error: `Genre "${genre}" is not a valid rock/metal genre`,
    }),
  );
  process.exit(1);
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_WRITER_MODEL || "deepseek-chat";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY is not set");
  process.exit(1);
}
if (!isDryRun && !DATABASE_URL) {
  console.error("DATABASE_URL is not set (use --dry-run to skip DB write)");
  process.exit(1);
}

// ── Slug generation ───────────────────────────────────────────────────────

function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const articleSlug = `${toSlug(artist)}-${toSlug(track)}`;

// ── DeepSeek API call ─────────────────────────────────────────────────────

function deepseekRequest(body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: "api.deepseek.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Length": payload.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse Groq response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── Prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a music journalist writing for a rock and metal website called YehThatRocks. Your writing style is direct, opinionated, specific, and irreverent. You write like someone who has spent a lot of time listening to heavy music and is not impressed by journalists who haven't.

TONE RULES - follow these without exception:
- Short declarative sentences. Subject, verb, object. No padding.
- Strong opinions stated as facts. Not "some people think" - say what you think.
- Specific musical details: riff structures, vocal techniques, production choices, drum patterns. No vague praise.
- Never hedge. No "arguably", "one might say", "in a sense", "seemingly".
- Never use em dashes (—). Use periods or commas instead.
- Never use the construction "it's not X, it's Y". Just say what it is.
- Never say "delve", "tapestry", "journey", "testament to", "sonic landscape", "soundscape".
- Never say "In conclusion" or "In summary".
- No corporate music-press speak like "ethereal", "evocative", "haunting" used as empty filler words.
- End cleanly. No "final thoughts" paragraph.
- You may start paragraphs with "I" where the opinion is personal and specific, but vary your openings — do not default to "I think" or "I believe."

OPENING VARIETY - each article must open differently:
- NEVER use this formula or any variant: "[Artist] [did something]. I don't care about [X]. What I do care about is [Y]." This is banned.
- Also banned: "[Artist] just released/released/dropped [track] and..." or "Here is [track] by [artist], a [genre] track that..."
- Rotate through different opening approaches: drop the reader into a specific moment in the track, start with a contradiction, open with a provocative claim about the genre, begin with a technical observation most people miss, or address the reader directly with a challenge.
- If your first two sentences feel predictable, scrap them and start again.

WRITE LIKE A HUMAN:
- Vary sentence length. Mix short punchy sentences with longer ones that build momentum.
- Use sentence fragments for emphasis. Sparingly but deliberately.
- Sprinkle in mild expletives where they land: "damn", "hell", "bloody", "crap", "bullshit". Once or twice per article. Do not force them.
- Real humans start sentences with "And" or "But" sometimes. So can you.
- If your prose reads like it was generated from instructions, delete it and write something that sounds like a person talking about music they actually care about.
- I before a paragraph is fine when the take is specific and personal. Vary whether you use it.
- RED LINE: Never mock, dismiss, trivialise, or express contempt for real people's serious illness, death, disability, personal tragedy, or suffering. Being irreverent about music is fine — being cruel about cancer, death, or human tragedy is not. If the news angle touches someone's illness or death, write about the music, not the human cost as a punchline. "I don't care about X's cancer" reads as sociopathic, not irreverent.`;

STRUCTURE: Output a JSON object with this exact shape:
{
  "title": "Artist - Track: A Short Punchy Title",
  "kicker": "Genre Label",
  "deck": "One or two sentences that summarize the article's argument",
  "body": [
    {"type": "p", "text": "Opening paragraph..."},
    {"type": "h2", "text": "Section heading"},
    {"type": "p", "text": "Body paragraph..."},
    ...
  ],
  "seoDescription": "150-200 character SEO meta description",
  "seoKeywords": "comma separated keywords"
}

The body should have 6 to 10 blocks. Use h2 headings to break up the article into 3 to 4 named sections. Each section should have 1 to 2 paragraphs. The final section should point listeners toward the YehThatRocks app to watch the video.

Do not wrap in markdown code fences. Output raw JSON only.`;

function buildUserPrompt(artist, track, genre) {
  return `Write a magazine article about "${track}" by ${artist}. Genre: ${genre}.

The article should cover:
1. Why this track or record matters in context of when it came out
2. Specific musical elements that make it work (riffs, vocals, drums, production)
3. What's technically impressive or unusual about it
4. Where it sits in the band's catalogue and the genre more broadly
5. What to listen to next (related artists or albums), and mention that YehThatRocks has them

Be specific. No filler. No AI-speak. Real sentences about real music. Vary your opening — pick an approach you haven't used recently. If you catch yourself starting with "[Artist] [verb] [track]" you're being boring. Start with the music. Start with a contradiction. Start with a specific detail nobody else noticed. Do not start by dismissing the artist or the genre as a setup for your real opinion.`;
}

// ── Generate article ──────────────────────────────────────────────────────

async function generateArticle() {
  console.log(`Generating article for: ${artist} - ${track} (${genre})`);
  console.log(`Model: ${DEEPSEEK_MODEL}`);

  const response = await deepseekRequest({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(artist, track, genre) },
    ],
    temperature: 0.9,
    max_tokens: 2000,
  });

  if (response.error) {
    throw new Error(`Groq API error: ${JSON.stringify(response.error)}`);
  }

  const rawContent = response.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("No content in Groq response");
  }

  // Strip markdown fences if the model wrapped it anyway
  const jsonText = rawContent
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let article;
  try {
    article = JSON.parse(jsonText);
  } catch {
    throw new Error(`Failed to parse article JSON:\n${jsonText.slice(0, 400)}`);
  }

  // Validate required fields
  const required = ["title", "kicker", "deck", "body", "seoDescription", "seoKeywords"];
  for (const field of required) {
    if (!article[field]) {
      throw new Error(`Generated article is missing field: ${field}`);
    }
  }

  // Apply overrides
  if (deckOverride) {
    article.deck = deckOverride;
  }

  // Post-process body: strip any accidental em dashes
  if (Array.isArray(article.body)) {
    article.body = article.body.map((block) => {
      if (typeof block.text === "string") {
        block.text = block.text.replace(/\u2014/g, ",").replace(/\u2013/g, "-");
      }
      return block;
    });
  }

  return article;
}

// ── DB insert ─────────────────────────────────────────────────────────────

async function saveToDatabase(article) {
  const urlStr = DATABASE_URL;
  // Parse MySQL URL: mysql://user:pass@host:port/dbname
  const m = urlStr.match(/mysql:\/\/([^:]+):([^@]+)@([^:/]+):?(\d+)?\/(.+)/);
  if (!m) throw new Error("Could not parse DATABASE_URL");

  const [, user, password, host, port, database] = m;
  const conn = await mysql.createConnection({
    host,
    port: Number(port || 3306),
    user,
    password,
    database,
  });

  try {
    // Check for existing slug
    const [existing] = await conn.execute(
      "SELECT id FROM magazine_articles WHERE slug = ? LIMIT 1",
      [articleSlug]
    );

    if (existing.length > 0) {
      if (!overwrite) {
        console.error(`Article with slug "${articleSlug}" already exists. Use --overwrite to replace it.`);
        process.exit(1);
      }
      await conn.execute(
        `UPDATE magazine_articles SET
          title=?, kicker=?, deck=?, artist=?, track_name=?, genre=?,
          video_id=?, body=?, seo_description=?, seo_keywords=?, updated_at=NOW(3)
        WHERE slug=?`,
        [
          article.title, article.kicker, article.deck, artist, track, genre,
          videoId, JSON.stringify(article.body), article.seoDescription, article.seoKeywords,
          articleSlug,
        ]
      );
      console.log(`Updated existing article: ${articleSlug}`);
    } else {
      await conn.execute(
        `INSERT INTO magazine_articles
          (slug, title, kicker, deck, artist, track_name, genre, video_id, body, seo_description, seo_keywords)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          articleSlug, article.title, article.kicker, article.deck,
          artist, track, genre, videoId,
          JSON.stringify(article.body), article.seoDescription, article.seoKeywords,
        ]
      );
      console.log(`Inserted new article: ${articleSlug}`);
    }
  } finally {
    await conn.end();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const article = await generateArticle();

  if (isDryRun) {
    console.log("\n── Generated Article ──────────────────────────────────────────");
    console.log(JSON.stringify({ slug: articleSlug, videoId, ...article }, null, 2));
    console.log("── End (dry run, not saved) ──────────────────────────────────");
    return;
  }

  await saveToDatabase(article);
  let shareResult = { status: "skipped", reason: "generation-complete" };
  try {
    shareResult = await maybeShareMagazineArticle({
      slug: articleSlug,
      title: article.title,
      artist,
      track,
      genre,
      videoId,
    });
  } catch (shareError) {
    shareResult = {
      status: "error",
      error: shareError instanceof Error ? shareError.message : String(shareError),
    };
  }
  console.log(`\nDone. Article URL: /magazine/${articleSlug}`);
  console.log(`Watch URL: /?v=${videoId}&resume=1`);
  console.log(`Facebook share: ${JSON.stringify(shareResult)}`);
}

main().catch((err) => {
  console.error("Generation failed:", err.message);
  process.exit(1);
});