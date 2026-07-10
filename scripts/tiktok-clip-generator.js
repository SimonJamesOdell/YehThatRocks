#!/usr/bin/env node

/**
 * TikTok / YouTube Shorts clip generator.
 *
 * Generates short vertical video clips from YouTube thumbnails suitable
 * for TikTok, YouTube Shorts, and Instagram Reels. Uses FFmpeg to:
 *   - Scale the thumbnail to 1080x1920 (vertical)
 *   - Add dark background bars
 *   - Overlay artist/track text
 *   - Fade in/out
 *   - Output a 12-second MP4 clip
 *
 * No audio extraction — avoids YouTube ToS concerns. The clips are
 * designed for "photo mode" / visual-only posts with text overlay.
 *
 * Prerequisites:
 *   - FFmpeg installed and on PATH (Linux: apt install ffmpeg)
 *   - Node.js with fetch (18+)
 *
 * Usage:
 *   node scripts/tiktok-clip-generator.js --dry-run          (list candidates)
 *   node scripts/tiktok-clip-generator.js --count 5          (generate 5 clips)
 *   node scripts/tiktok-clip-generator.js --video-id dQw4w9WgXcQ  (single)
 *
 * Output: clips/ directory, one MP4 per video
 *
 * Upload these manually via TikTok web or schedule with the Puppeteer
 * uploader (see TRAFFIC_ROADMAP.md Phase 4 for YouTube Shorts pipeline).
 *
 * Phase 2.7 / 4.2 — Short-form video clips (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const https = require("node:https");
const { execSync, spawnSync } = require("node:child_process");
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
  getTopPlayableCandidates,
} = require("./lib/social-share-utils");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLIPS_DIR = path.resolve(process.cwd(), "clips");
const CLIP_DURATION_SEC = 12;
const WIDTH = 1080;
const HEIGHT = 1920;
const APP_URL = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");

// ---------------------------------------------------------------------------
// FFmpeg clip generation
// ---------------------------------------------------------------------------

/**
 * Download a YouTube thumbnail to a local file.
 */
function downloadThumbnail(videoId, outputPath) {
  return new Promise((resolve, reject) => {
    const url = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/maxresdefault.jpg`;
    const file = fs.createWriteStream(outputPath);
    https.get(url, (response) => {
      // maxresdefault may 404; fall back to hqdefault
      if (response.statusCode === 404) {
        file.close();
        fs.unlinkSync(outputPath);
        const fallbackUrl = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
        https.get(fallbackUrl, (fbResponse) => {
          fbResponse.pipe(fs.createWriteStream(outputPath));
          fbResponse.on("end", resolve);
          fbResponse.on("error", reject);
        }).on("error", reject);
        return;
      }
      response.pipe(file);
      response.on("end", resolve);
      response.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Sanitize text for FFmpeg drawtext filter (escape special chars).
 */
function escapeDrawText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "'\\\\''")
    .replace(/%/g, "\\\\%")
    .replace(/{/g, "\\\\{")
    .replace(/}/g, "\\\\}");
}

/**
 * Generate a TikTok/Shorts clip using FFmpeg.
 *
 * Pipeline:
 *   1. Scale thumbnail to fit 1080x1920 with dark background
 *   2. Add artist/track text overlay at the top
 *   3. Add "Watch at yehthatrocks.com" at the bottom
 *   4. Simple fade in/out
 *   5. Output 12-second MP4 (H.264, no audio)
 */
function generateClip({ videoId, artist, title, genre, thumbnailPath, outputPath }) {
  const sanitizedArtist = escapeDrawText(artist || "Unknown Artist");
  const sanitizedTitle = escapeDrawText(title || "Unknown Track");
  const sanitizedGenre = escapeDrawText(genre || "Rock / Metal");

  // Main text: "ARTIST — TRACK"
  const mainText = `${sanitizedArtist} \\-\\- ${sanitizedTitle}`;

  // Sub text: "[Genre]"
  const subText = `[${sanitizedGenre}]`;

  // CTA text
  const ctaText = "yehthatrocks.com";

  // Font size scaled for 1080w
  const mainFontSize = 52;
  const subFontSize = 36;
  const ctaFontSize = 32;

  // Fade durations
  const fadeInFrames = 30;   // 1 second at 30fps
  const fadeOutFrames = 30;  // 1 second
  const fadeStartFrame = (CLIP_DURATION_SEC * 30) - fadeOutFrames;

  // Build FFmpeg filter
  // scale thumbnail to fit width, pad to 1080x1920 with black
  const filter = [
    // Scale to fit within 1080x1920, maintaining aspect ratio
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    // Pad to exact dimensions with black bars
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    // Main text overlay (artist - track)
    `drawtext=text='${mainText}':fontsize=${mainFontSize}:fontcolor=white:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:x=(w-text_w)/2:y=80:shadowcolor=black:shadowx=3:shadowy=3`,
    // Genre text
    `drawtext=text='${subText}':fontsize=${subFontSize}:fontcolor=#ff4444:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:x=(w-text_w)/2:y=150:shadowcolor=black:shadowx=2:shadowy=2`,
    // CTA text at bottom
    `drawtext=text='${ctaText}':fontsize=${ctaFontSize}:fontcolor=#aaaaaa:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:x=(w-text_w)/2:y=h-120:shadowcolor=black:shadowx=2:shadowy=2`,
    // Fade in/out
    `fade=t=in:st=0:d=1`,
    `fade=t=out:st=${CLIP_DURATION_SEC - 1}:d=1`,
  ].join(",");

  const args = [
    "-loop", "1",
    "-i", thumbnailPath,
    "-t", String(CLIP_DURATION_SEC),
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-an", // no audio
    "-y",  // overwrite
    outputPath,
  ];

  console.log(`[tiktok] Generating clip for: ${artist} — ${title}`);
  const result = spawnSync("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "";
    // If font is missing, try without fontfile (uses FFmpeg default)
    if (stderr.includes("fontfile") || stderr.includes("Cannot find font")) {
      console.log("[tiktok] Font not found, retrying with default font...");
      const fallbackFilter = filter.replace(/fontfile=[^:']+/g, "");
      const fallbackArgs = [
        "-loop", "1",
        "-i", thumbnailPath,
        "-t", String(CLIP_DURATION_SEC),
        "-vf", fallbackFilter,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-an",
        "-y",
        outputPath,
      ];
      const fallbackResult = spawnSync("ffmpeg", fallbackArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60000,
      });
      if (fallbackResult.status !== 0) {
        throw new Error(`FFmpeg failed (fallback): ${fallbackResult.stderr?.toString().slice(0, 300)}`);
      }
    } else {
      throw new Error(`FFmpeg failed: ${stderr.slice(0, 300)}`);
    }
  }

  return outputPath;
}

// ---------------------------------------------------------------------------
// Check FFmpeg availability
// ---------------------------------------------------------------------------

function checkFfmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  if (!checkFfmpeg()) {
    console.error("[tiktok] ❌ FFmpeg is not installed or not on PATH.");
    console.error("Install: apt install ffmpeg  (Linux)  or  winget install ffmpeg  (Windows)");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const videoIdArg = args.includes("--video-id") ? args[args.indexOf("--video-id") + 1] : null;
  const countArg = args.includes("--count") ? parseInt(args[args.indexOf("--count") + 1], 10) : 5;
  const count = Number.isFinite(countArg) && countArg > 0 ? Math.min(countArg, 20) : 5;

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // ── State tracking ─────────────────────────────────────────────────────
  const statePath = path.resolve(process.cwd(), "logs/tiktok-clips-state.json");
  const state = readState(statePath);
  const generatedIds = new Set(
    (Array.isArray(state.clips) ? state.clips : []).map((c) => String(c.videoId || "").trim()).filter(Boolean),
  );

  const dbAdapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: dbAdapter });

  let candidates;
  try {
    if (videoIdArg) {
      // Single video mode
      candidates = [{ videoId: videoIdArg, artist: "Single", title: "Clip", genre: "Rock / Metal", favourited: 0 }];
    } else {
      const pool = await getTopPlayableCandidates(prisma, 300);
      const fresh = pool.filter((v) => !generatedIds.has(v.videoId));
      candidates = fresh.length > 0 ? fresh : pool;
    }
  } finally {
    await prisma.$disconnect();
  }

  const selected = candidates.slice(0, count);

  if (dryRun) {
    console.log(`[tiktok] Dry run — would generate ${selected.length} clips:`);
    for (const video of selected) {
      console.log(`  🎬 ${video.artist} — ${video.title} [${video.genre}]  (${video.videoId})`);
    }
    return;
  }

  // ── Generate clips ─────────────────────────────────────────────────────
  ensureDirFor(path.join(CLIPS_DIR, ".keep"));

  const newClips = [];
  for (const video of selected) {
    const videoId = String(video.videoId || "").trim();
    if (!videoId) continue;

    const thumbPath = path.join(CLIPS_DIR, `${videoId}.jpg`);
    const clipPath = path.join(CLIPS_DIR, `${videoId}.mp4`);

    try {
      // Download thumbnail
      console.log(`[tiktok] Downloading thumbnail for ${videoId}...`);
      await downloadThumbnail(videoId, thumbPath);

      // Generate clip
      generateClip({
        videoId,
        artist: video.artist || "Unknown Artist",
        title: video.title || "Unknown Track",
        genre: video.genre || "Rock / Metal",
        thumbnailPath: thumbPath,
        outputPath: clipPath,
      });

      // Clean up thumbnail
      try { fs.unlinkSync(thumbPath); } catch {}

      const stats = fs.statSync(clipPath);
      console.log(`[tiktok] ✅ ${clipPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

      newClips.push({
        generatedAt: new Date().toISOString(),
        videoId,
        artist: video.artist,
        title: video.title,
        genre: video.genre,
        filePath: clipPath,
      });
    } catch (err) {
      console.error(`[tiktok] ❌ Failed for ${videoId}: ${err.message}`);
      // Clean up partial files
      try { fs.unlinkSync(thumbPath); } catch {}
      try { fs.unlinkSync(clipPath); } catch {}
    }
  }

  // ── Save state ─────────────────────────────────────────────────────────
  const nextState = {
    lastRunAt: new Date().toISOString(),
    clips: [...(Array.isArray(state.clips) ? state.clips : []), ...newClips].slice(-1000),
  };
  writeState(statePath, nextState);

  console.log(`[tiktok] Done. Generated ${newClips.length}/${selected.length} clips in ${CLIPS_DIR}/`);
  console.log("[tiktok] Upload these clips to TikTok, YouTube Shorts, or Instagram Reels.");
}

main().catch((error) => {
  console.error("[tiktok] Failed:", error?.message || error);
  process.exit(1);
});
