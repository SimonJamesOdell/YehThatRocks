#!/usr/bin/env node

/**
 * YouTube playlist auto-curation script.
 *
 * Creates and maintains genre-based YouTube playlists on the YehThatRocks
 * channel. Each playlist corresponds to a music genre and contains the
 * top videos for that genre, ordered by favourites (popularity).
 *
 * Public playlists rank in YouTube search, drive channel subscribers,
 * and create discovery funnels back to the site.
 *
 * Playlist format:
 *   "Best [Genre] Rock & Metal — YehThatRocks"
 *   Description includes site link + genre info
 *
 * Usage:
 *   node scripts/youtube-playlist-curator.js --dry-run       (show what would be added)
 *   node scripts/youtube-playlist-curator.js --force         (sync all playlists)
 *   node scripts/youtube-playlist-curator.js --list          (list existing playlists)
 *
 * Prerequisites:
 *   npm install googleapis
 *   Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env.local
 *   Run once interactively to complete OAuth consent flow
 *
 * Required env:
 *   YOUTUBE_CLIENT_ID — Google OAuth 2.0 client ID
 *   YOUTUBE_CLIENT_SECRET — Google OAuth 2.0 client secret
 *   DATABASE_URL — MariaDB connection string
 *
 * Optional env:
 *   YOUTUBE_PLAYLIST_STATE_PATH — state file path
 *   YOUTUBE_MAX_PLAYLIST_VIDEOS — max videos per playlist (default: 50)
 *   YOUTUBE_MAX_NEW_PER_RUN — max new additions per run (default: 10)
 *   APP_URL — site URL for link in description
 *
 * Phase 4.4 — YouTube playlist auto-curation (TRAFFIC_ROADMAP.md)
 */

"use strict";

const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { getYouTubeClient } = require("./lib/youtube-auth");

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
// Genre playlist definitions
// ---------------------------------------------------------------------------

/**
 * Genre playlists to maintain.
 *
 * Each entry defines:
 *   - id: stable internal identifier (used in state tracking)
 *   - title: YouTube playlist title
 *   - genreNorm: matching genre_norm value in the database
 *   - description: playlist description
 */
const GENRE_PLAYLISTS = [
  {
    id: "progressive-metal",
    title: "Best Progressive Metal — YehThatRocks",
    genreNorm: "progressive metal",
    description: "The best progressive metal music videos, curated by YehThatRocks. New discoveries every week. https://yehthatrocks.com",
  },
  {
    id: "death-metal",
    title: "Best Death Metal — YehThatRocks",
    genreNorm: "death metal",
    description: "Essential death metal videos. From classic to modern, curated by YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "black-metal",
    title: "Best Black Metal — YehThatRocks",
    genreNorm: "black metal",
    description: "The finest black metal music videos. Discover new bands and classics at https://yehthatrocks.com",
  },
  {
    id: "thrash-metal",
    title: "Best Thrash Metal — YehThatRocks",
    genreNorm: "thrash metal",
    description: "Thrash metal at its best. Curated music videos from YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "doom-metal",
    title: "Best Doom & Stoner Metal — YehThatRocks",
    genreNorm: "doom metal",
    description: "Heavy, slow, and crushing. The best doom and stoner metal videos curated by YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "power-metal",
    title: "Best Power Metal — YehThatRocks",
    genreNorm: "power metal",
    description: "Epic power metal music videos. Discover new bands at https://yehthatrocks.com",
  },
  {
    id: "metalcore",
    title: "Best Metalcore — YehThatRocks",
    genreNorm: "metalcore",
    description: "The best metalcore music videos, curated daily by YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "hard-rock",
    title: "Best Hard Rock — YehThatRocks",
    genreNorm: "hard rock",
    description: "Essential hard rock music videos. Classic and modern, curated by YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "classic-rock",
    title: "Best Classic Rock — YehThatRocks",
    genreNorm: "classic rock",
    description: "Timeless classic rock music videos. Curated by YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "alternative-metal",
    title: "Best Alternative Metal — YehThatRocks",
    genreNorm: "alternative metal",
    description: "Alternative and nu-metal music videos. Curated by YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "folk-metal",
    title: "Best Folk & Viking Metal — YehThatRocks",
    genreNorm: "folk metal",
    description: "Folk and Viking metal music videos from around the world. Curated by YehThatRocks. https://yehthatrocks.com",
  },
  {
    id: "symphonic-metal",
    title: "Best Symphonic Metal — YehThatRocks",
    genreNorm: "symphonic metal",
    description: "Orchestral and symphonic metal at its finest. Curated by YehThatRocks. https://yehthatrocks.com",
  },
];

const APP_URL = (process.env.APP_URL || "https://yehthatrocks.com").trim().replace(/\/$/, "");

// ---------------------------------------------------------------------------
// YouTube playlist operations
// ---------------------------------------------------------------------------

/**
 * Find an existing playlist by title, or return null.
 */
async function findPlaylistByTitle(youtube, title) {
  const existing = await youtube.playlists.list({
    part: ["snippet", "status"],
    mine: true,
    maxResults: 50,
  });

  const found = (existing.data.items || []).find(
    (item) => item.snippet && item.snippet.title === title,
  );

  return found || null;
}

/**
 * Create a new public playlist.
 * Returns the playlist ID.
 */
async function createPlaylist(youtube, title, description) {
  const response = await youtube.playlists.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        tags: ["rock", "metal", "music", "yehthatrocks"],
      },
      status: {
        privacyStatus: "public",
      },
    },
  });

  return response.data.id;
}

/**
 * Get all video IDs currently in a playlist.
 */
async function getPlaylistVideoIds(youtube, playlistId) {
  const ids = [];
  let pageToken;

  do {
    const response = await youtube.playlistItems.list({
      part: ["snippet"],
      playlistId,
      maxResults: 50,
      pageToken,
    });

    for (const item of response.data.items || []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (videoId) {
        ids.push(videoId);
      }
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return ids;
}

/**
 * Add a video to a playlist.
 */
async function addVideoToPlaylist(youtube, playlistId, youtubeVideoId) {
  await youtube.playlistItems.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId: youtubeVideoId,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/**
 * Get top videos for a genre from the database.
 * Returns videos with their YouTube videoId and metadata.
 */
async function getTopVideosForGenre(prisma, genreNorm, limit) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId,
        COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown artist') AS artist,
        COALESCE(NULLIF(TRIM(v.parsedTrack), ''), NULLIF(TRIM(v.title), ''), 'Unknown track') AS title,
        COALESCE(NULLIF(TRIM(v.genre), ''), 'Rock / Metal') AS genre,
        COALESCE(v.favourited, 0) AS favourited
      FROM videos v
      INNER JOIN (SELECT DISTINCT sv.video_id FROM site_videos sv WHERE sv.status = 'available') sv_avail ON sv_avail.video_id = v.id
      WHERE v.videoId IS NOT NULL
        AND v.approved = 1
        AND v.genre_norm = ?
      ORDER BY v.favourited DESC, v.id DESC
      LIMIT ?
    `,
    genreNorm,
    limit,
  );

  return rows.map((row) => ({
    videoId: String(row.videoId || "").trim(),
    artist: String(row.artist || "Unknown artist"),
    title: String(row.title || "Unknown track"),
    genre: String(row.genre || "Rock / Metal"),
    favourited: Number(row.favourited) || 0,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const forceRun = args.includes("--force");
  const listOnly = args.includes("--list");

  // ── Config ─────────────────────────────────────────────────────────────
  const maxPlaylistVideos = toPositiveInt(process.env.YOUTUBE_MAX_PLAYLIST_VIDEOS || "50", 50);
  const maxNewPerRun = toPositiveInt(process.env.YOUTUBE_MAX_NEW_PER_RUN || "10", 10);
  const statePath = path.resolve(
    process.cwd(),
    process.env.YOUTUBE_PLAYLIST_STATE_PATH || "logs/youtube-playlist-state.json",
  );

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  // ── State ──────────────────────────────────────────────────────────────
  const state = readState(statePath);
  const playlistsState = typeof state.playlists === "object" && state.playlists !== null
    ? state.playlists
    : {};

  // ── List mode ──────────────────────────────────────────────────────────
  if (listOnly) {
    const youtube = await getYouTubeClient();
    const response = await youtube.playlists.list({
      part: ["snippet", "contentDetails"],
      mine: true,
      maxResults: 50,
    });

    console.log("[youtube-playlists] Your YouTube playlists:");
    for (const pl of response.data.items || []) {
      console.log(`  ${pl.snippet?.title}`);
      console.log(`    ID: ${pl.id}  |  Videos: ${pl.contentDetails?.itemCount || 0}`);
      console.log(`    ${pl.snippet?.description?.split("\n")[0] || ""}`);
      console.log();
    }
    return;
  }

  // ── Sync playlists ─────────────────────────────────────────────────────
  console.log(`[youtube-playlists] Syncing ${GENRE_PLAYLISTS.length} genre playlists...`);

  const youtube = dryRun
    ? null // Don't authenticate for dry-run
    : await getYouTubeClient();

  const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter });

  const results = [];

  try {
    for (const genre of GENRE_PLAYLISTS) {
      const plState = playlistsState[genre.id] || {
        playlistId: null,
        addedVideoIds: [],
        lastSyncedAt: null,
      };

      console.log(`\n[youtube-playlists] ── ${genre.title} ──`);

      // Get top videos for this genre from DB
      const topVideos = await getTopVideosForGenre(prisma, genre.genreNorm, maxPlaylistVideos * 2);
      console.log(`  DB: ${topVideos.length} candidate videos`);

      if (topVideos.length === 0) {
        console.log(`  ⚠ No videos found for genre "${genre.genreNorm}". Skipping.`);
        results.push({ genre: genre.id, status: "no_videos" });
        continue;
      }

      if (dryRun) {
        console.log(`  [dry-run] Would ensure playlist exists: "${genre.title}"`);
        console.log(`  [dry-run] Would add up to ${Math.min(topVideos.length, maxNewPerRun)} new videos`);

        const newVideos = topVideos.filter(
          (v) => !plState.addedVideoIds.includes(v.videoId),
        );
        const toAdd = newVideos.slice(0, maxNewPerRun);

        if (toAdd.length > 0) {
          console.log(`  [dry-run] New videos to add:`);
          for (const v of toAdd) {
            console.log(`    ${v.artist} — ${v.title}  [fav: ${v.favourited}]  (${v.videoId})`);
          }
        } else {
          console.log(`  [dry-run] No new videos to add.`);
        }

        results.push({ genre: genre.id, status: "dry_run" });
        continue;
      }

      // ── Ensure playlist exists ─────────────────────────────────────────
      let playlistId = plState.playlistId;

      if (!playlistId || forceRun) {
        const existing = await findPlaylistByTitle(youtube, genre.title);

        if (existing) {
          playlistId = existing.id;
          console.log(`  Playlist exists: ${playlistId}`);
        } else {
          playlistId = await createPlaylist(youtube, genre.title, genre.description);
          console.log(`  Created playlist: ${playlistId}`);
        }
      }

      // ── Get current playlist contents ──────────────────────────────────
      const currentVideoIds = await getPlaylistVideoIds(youtube, playlistId);
      console.log(`  Current: ${currentVideoIds.length} videos in playlist`);

      // ── Determine videos to add ────────────────────────────────────────
      const currentSet = new Set(currentVideoIds);
      const addedSet = new Set(plState.addedVideoIds);

      const newVideos = topVideos.filter(
        (v) => !currentSet.has(v.videoId) && !addedSet.has(v.videoId),
      );

      const toAdd = newVideos.slice(0, maxNewPerRun);

      if (toAdd.length === 0) {
        console.log(`  No new videos to add.`);
        playlistsState[genre.id] = {
          playlistId,
          addedVideoIds: [...addedSet],
          lastSyncedAt: new Date().toISOString(),
        };
        results.push({ genre: genre.id, status: "up_to_date", playlistId });
        continue;
      }

      // ── Add videos ─────────────────────────────────────────────────────
      console.log(`  Adding ${toAdd.length} video(s)...`);
      let added = 0;

      for (const video of toAdd) {
        try {
          await addVideoToPlaylist(youtube, playlistId, video.videoId);
          addedSet.add(video.videoId);
          added++;
          console.log(`    ✅ ${video.artist} — ${video.title}`);
        } catch (err) {
          console.error(`    ❌ ${video.artist} — ${video.title}:`, err?.message || err);
        }

        // Small delay between additions
        if (toAdd.indexOf(video) < toAdd.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      playlistsState[genre.id] = {
        playlistId,
        addedVideoIds: [...addedSet],
        lastSyncedAt: new Date().toISOString(),
      };

      results.push({ genre: genre.id, status: "updated", added, playlistId });
    }
  } finally {
    await prisma.$disconnect();
  }

  // ── Save state ────────────────────────────────────────────────────────
  const nextState = {
    lastRunAt: new Date().toISOString(),
    playlists: playlistsState,
  };
  writeState(statePath, nextState);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n[youtube-playlists] ════════════════════════");
  console.log("[youtube-playlists] Summary:");
  for (const r of results) {
    const emoji = r.status === "updated" ? "✅" : r.status === "up_to_date" ? "✔" : r.status === "dry_run" ? "🔍" : "⚠";
    console.log(`  ${emoji} ${r.genre}: ${r.status}${r.added ? ` (+${r.added})` : ""}`);
  }
}

main().catch((error) => {
  console.error("[youtube-playlists] Failed:", error?.message || error);
  process.exit(1);
});
