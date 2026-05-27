#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

function loadDatabaseEnv() {
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
  }
}

loadDatabaseEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const CONFIDENCE_THRESHOLD = Number(process.env.GENRE_RECLASSIFY_THRESHOLD || "0.9");
const BATCH_SIZE = Math.max(10, Number(process.env.GENRE_RECLASSIFY_BATCH_SIZE || "150"));
const IDLE_SLEEP_MS = Math.max(1000, Number(process.env.GENRE_RECLASSIFY_IDLE_SLEEP_MS || "15000"));
const STATUS_FLUSH_EVERY = Math.max(1, Number(process.env.GENRE_RECLASSIFY_STATUS_EVERY || "25"));
const MUSICBRAINZ_DELAY_MS = Math.max(1000, Number(process.env.GENRE_RECLASSIFY_MB_DELAY_MS || "1200"));
const ENABLE_GROQ = String(process.env.GENRE_RECLASSIFY_USE_GROQ || "").trim() === "1";
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();

const ROCK_METAL_PATTERN = /\b(rock|metal|doom|death|black|thrash|sludge|stoner|hardcore|punk|grind|djent|nu metal|metalcore|post metal|heavy|prog|progressive|gothic|folk metal|power metal|industrial metal|symphonic metal)\b/i;
const NON_ROCK_PATTERN = /\b(pop|hip\s?hop|rap|r&b|country|edm|techno|house|reggaeton|k\s?pop|j\s?pop|latin pop|afrobeats|trap|dancehall|salsa|bachata|classical|jazz|blues)\b/i;

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 5,
  decimalNumbers: true,
  supportBigNumbers: true,
});

let mbLastRequestAt = 0;
const artistSignalMemoryCache = new Map();

function normalizeGenreLabel(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ");
}

function toTitleCase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeArtistKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isRockOrMetalGenre(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (ROCK_METAL_PATTERN.test(v)) return true;
  if (NON_ROCK_PATTERN.test(v)) return false;
  return false;
}

function classifyRockConfidenceFromText(value) {
  const v = String(value || "").trim();
  if (!v) return 0;
  if (ROCK_METAL_PATTERN.test(v)) return 0.95;
  if (NON_ROCK_PATTERN.test(v)) return 0.95;
  return 0.5;
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_genre_reclassify_state (
      id TINYINT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'idle',
      total_videos BIGINT NOT NULL DEFAULT 0,
      last_video_id BIGINT NOT NULL DEFAULT 0,
      processed_count BIGINT NOT NULL DEFAULT 0,
      updated_count BIGINT NOT NULL DEFAULT 0,
      deleted_count BIGINT NOT NULL DEFAULT 0,
      queued_count BIGINT NOT NULL DEFAULT 0,
      started_at DATETIME(3) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      last_message VARCHAR(512) NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_genre_review_queue (
      video_id VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
      proposed_genre VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
      confidence DECIMAL(6,4) NULL,
      reason VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
      enqueued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (video_id),
      KEY idx_admin_genre_review_queue_enqueued_at (enqueued_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS genre_reclassify_artist_cache (
      artist_key VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
      canonical_name VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
      best_genre VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
      rock_signal TINYINT(1) NOT NULL DEFAULT 0,
      confidence DECIMAL(6,4) NOT NULL DEFAULT 0,
      source VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (artist_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    INSERT IGNORE INTO admin_genre_reclassify_state (id, status) VALUES (1, 'idle')
  `);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitMusicBrainz() {
  const now = Date.now();
  const wait = Math.max(0, mbLastRequestAt + MUSICBRAINZ_DELAY_MS - now);
  if (wait > 0) {
    await sleep(wait);
  }
  mbLastRequestAt = Date.now();
}

async function readState() {
  const [rows] = await pool.query(
    `SELECT id, status, total_videos, last_video_id, processed_count, updated_count, deleted_count, queued_count, started_at, updated_at, last_message
     FROM admin_genre_reclassify_state
     WHERE id = 1
     LIMIT 1`
  );
  return rows[0] || null;
}

async function updateState(fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);
  await pool.query(
    `UPDATE admin_genre_reclassify_state SET ${setClause}, updated_at = UTC_TIMESTAMP(3) WHERE id = 1`,
    values,
  );
}

async function fetchBatch(lastVideoId) {
  const [rows] = await pool.query(
    `SELECT id, videoId, title, parsedArtist, parsedTrack, channelTitle, genre
     FROM videos
     WHERE id > ?
     ORDER BY id ASC
     LIMIT ?`,
    [lastVideoId, BATCH_SIZE],
  );
  return rows;
}

async function queryArtistStatsGenre(normalizedArtist) {
  if (!normalizedArtist) return null;
  const [rows] = await pool.query(
    `SELECT genre
     FROM artist_stats
     WHERE normalized_artist = ?
       AND genre IS NOT NULL
       AND TRIM(genre) <> ''
     LIMIT 1`,
    [normalizedArtist],
  );
  return normalizeGenreLabel(rows[0]?.genre || null);
}

async function fetchMusicBrainzArtistSignal(artistName) {
  const normalizedArtist = normalizeArtistKey(artistName);
  if (!normalizedArtist) return null;

  const [cachedRows] = await pool.query(
    `SELECT canonical_name, best_genre, rock_signal, confidence, source
     FROM genre_reclassify_artist_cache
     WHERE artist_key = ?
     LIMIT 1`,
    [normalizedArtist],
  );

  if (cachedRows.length > 0) {
    const row = cachedRows[0];
    return {
      source: row.source,
      canonicalName: row.canonical_name,
      genre: normalizeGenreLabel(row.best_genre),
      confidence: Number(row.confidence || 0),
      isRock: Number(row.rock_signal || 0) === 1,
    };
  }

  await rateLimitMusicBrainz();

  const query = encodeURIComponent(`artist:"${artistName}"`);
  const url = `https://musicbrainz.org/ws/2/artist?query=${query}&limit=5&fmt=json`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "YehThatRocks/1.0 (https://yehthatrocks.com)",
        "Accept": "application/json",
      },
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  const artists = Array.isArray(payload?.artists) ? payload.artists : [];
  const targetKey = normalizeArtistKey(artistName);

  const exactMatches = artists.filter((entry) => normalizeArtistKey(entry?.name || "") === targetKey);
  const pick = (exactMatches.length > 0 ? exactMatches : artists)
    .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0))[0];

  if (!pick) {
    await pool.query(
      `INSERT INTO genre_reclassify_artist_cache (artist_key, canonical_name, best_genre, rock_signal, confidence, source)
       VALUES (?, NULL, NULL, 0, 0, 'musicbrainz')
       ON DUPLICATE KEY UPDATE canonical_name = VALUES(canonical_name), best_genre = VALUES(best_genre), rock_signal = VALUES(rock_signal), confidence = VALUES(confidence), source = VALUES(source), updated_at = UTC_TIMESTAMP(3)`,
      [normalizedArtist],
    );
    return null;
  }

  const tags = Array.isArray(pick.tags) ? pick.tags : [];
  tags.sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0));

  const bestTag = tags.find((tag) => typeof tag?.name === "string" && tag.name.trim().length > 0) || null;
  const bestGenre = bestTag ? toTitleCase(String(bestTag.name).trim()) : null;
  const rockTag = tags.find((tag) => isRockOrMetalGenre(String(tag?.name || "")));
  const nonRockTag = tags.find((tag) => NON_ROCK_PATTERN.test(String(tag?.name || "")));

  let isRock = false;
  if (rockTag) {
    isRock = true;
  } else if (bestGenre) {
    isRock = isRockOrMetalGenre(bestGenre);
  }

  const confidence = Math.min(
    0.98,
    Math.max(0.55, Number(pick.score || 0) / 100 * 0.8 + (bestTag ? 0.15 : 0.05) + (isRock || nonRockTag ? 0.05 : 0)),
  );

  await pool.query(
    `INSERT INTO genre_reclassify_artist_cache (artist_key, canonical_name, best_genre, rock_signal, confidence, source)
     VALUES (?, ?, ?, ?, ?, 'musicbrainz')
     ON DUPLICATE KEY UPDATE canonical_name = VALUES(canonical_name), best_genre = VALUES(best_genre), rock_signal = VALUES(rock_signal), confidence = VALUES(confidence), source = VALUES(source), updated_at = UTC_TIMESTAMP(3)`,
    [normalizedArtist, normalizeGenreLabel(pick.name || null), normalizeGenreLabel(bestGenre), isRock ? 1 : 0, confidence],
  );

  return {
    source: "musicbrainz",
    canonicalName: normalizeGenreLabel(pick.name || null),
    genre: normalizeGenreLabel(bestGenre),
    confidence,
    isRock,
  };
}

async function maybeClassifyWithGroq(video, sourceCandidates) {
  if (!ENABLE_GROQ || !GROQ_API_KEY) return null;
  const strongCandidate = sourceCandidates.some((entry) => entry.confidence >= CONFIDENCE_THRESHOLD);
  if (strongCandidate) return null;

  const prompt = [
    "Classify this video into the most specific genre label.",
    "Return JSON only:",
    '{"genre":string|null,"isRockOrMetal":boolean,"confidence":number}',
    `title: ${String(video.title || "")}`,
    `parsedArtist: ${String(video.parsedArtist || "")}`,
    `channelTitle: ${String(video.channelTitle || "")}`,
  ].join("\n");

  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 90,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a strict genre classification service." },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const genre = normalizeGenreLabel(parsed.genre || null);
  if (!genre) return null;

  const rawConfidence = Number(parsed.confidence || 0);
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0.5;
  const isRock = parsed.isRockOrMetal === true || isRockOrMetalGenre(genre);

  return {
    source: "groq",
    genre,
    confidence: Math.max(0.5, confidence),
    isRock,
  };
}

async function collectSignals(video) {
  const signals = [];
  const normalizedArtist = normalizeArtistKey(video.parsedArtist);

  const existingGenre = normalizeGenreLabel(video.genre);
  if (existingGenre) {
    signals.push({
      source: "video-existing",
      genre: existingGenre,
      confidence: 0.55,
      isRock: isRockOrMetalGenre(existingGenre),
    });
  }

  if (normalizedArtist) {
    const cached = artistSignalMemoryCache.get(normalizedArtist);
    if (cached) {
      if (cached.genre) {
        signals.push({
          source: cached.source,
          genre: cached.genre,
          confidence: cached.confidence,
          isRock: cached.isRock,
        });
      }
    } else {
      const artistStatsGenre = await queryArtistStatsGenre(normalizedArtist);
      if (artistStatsGenre) {
        signals.push({
          source: "artist-stats",
          genre: artistStatsGenre,
          confidence: 0.86,
          isRock: isRockOrMetalGenre(artistStatsGenre),
        });
      }

      const mbSignal = await fetchMusicBrainzArtistSignal(video.parsedArtist || "");
      if (mbSignal?.genre) {
        signals.push({
          source: "musicbrainz",
          genre: mbSignal.genre,
          confidence: Math.max(0.7, mbSignal.confidence),
          isRock: mbSignal.isRock,
        });
      }

      const memorySignal = {
        source: mbSignal?.source || (artistStatsGenre ? "artist-stats" : "none"),
        genre: mbSignal?.genre || artistStatsGenre || null,
        confidence: mbSignal?.genre ? Math.max(0.7, mbSignal.confidence) : (artistStatsGenre ? 0.86 : 0),
        isRock: mbSignal?.genre ? mbSignal.isRock : (artistStatsGenre ? isRockOrMetalGenre(artistStatsGenre) : false),
      };
      artistSignalMemoryCache.set(normalizedArtist, memorySignal);
    }
  }

  const groqSignal = await maybeClassifyWithGroq(video, signals);
  if (groqSignal) {
    signals.push(groqSignal);
  }

  return signals.filter((signal) => normalizeGenreLabel(signal.genre));
}

function chooseDecision(video, signals) {
  if (signals.length === 0) {
    return {
      action: "queue",
      proposedGenre: null,
      confidence: 0,
      reason: "no-sources",
    };
  }

  const grouped = new Map();
  let totalWeight = 0;
  let rockWeight = 0;
  let nonRockWeight = 0;

  for (const signal of signals) {
    const key = String(signal.genre).trim().toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        genre: normalizeGenreLabel(signal.genre),
        weight: 0,
        support: 0,
      });
    }
    const entry = grouped.get(key);
    entry.weight += Number(signal.confidence || 0);
    entry.support += 1;

    totalWeight += Number(signal.confidence || 0);
    if (signal.isRock) {
      rockWeight += Number(signal.confidence || 0);
    } else {
      nonRockWeight += Number(signal.confidence || 0);
    }
  }

  const ranked = Array.from(grouped.values()).sort((a, b) => b.weight - a.weight || b.support - a.support);
  const top = ranked[0] || null;

  if (!top || !top.genre) {
    return {
      action: "queue",
      proposedGenre: null,
      confidence: 0,
      reason: "no-top-genre",
    };
  }

  let confidence = totalWeight > 0 ? top.weight / totalWeight : 0;
  if (top.support >= 2) {
    confidence += 0.08;
  }
  confidence = Math.max(0, Math.min(1, confidence));

  const nonRockConfidence = totalWeight > 0 ? nonRockWeight / totalWeight : 0;

  if (
    confidence >= CONFIDENCE_THRESHOLD
    && nonRockConfidence >= CONFIDENCE_THRESHOLD
    && totalWeight >= 1.5
    && !isRockOrMetalGenre(top.genre)
  ) {
    return {
      action: "delete",
      proposedGenre: top.genre,
      confidence,
      reason: `high-confidence-non-rock:${top.genre}`,
    };
  }

  if (confidence >= CONFIDENCE_THRESHOLD) {
    return {
      action: "update",
      proposedGenre: top.genre,
      confidence,
      reason: `high-confidence-update:${top.genre}`,
    };
  }

  return {
    action: "queue",
    proposedGenre: top.genre,
    confidence,
    reason: `manual-review:${top.genre}`,
  };
}

async function deleteVideoEverywhere(video) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`DELETE FROM admin_genre_review_queue WHERE video_id = ?`, [video.videoId]);
    await conn.query(`DELETE FROM admin_catalog_review_queue WHERE video_id = ?`, [video.videoId]);
    await conn.query(`DELETE FROM watch_history WHERE video_id = ?`, [video.videoId]);
    await conn.query(`DELETE FROM messages WHERE video_id = ?`, [video.videoId]);
    await conn.query(`DELETE FROM related WHERE videoId = ? OR related = ?`, [video.videoId, video.videoId]);

    await conn.query(`DELETE FROM site_videos WHERE video_id = ?`, [video.id]);
    await conn.query(`DELETE FROM favourites WHERE videoId = ?`, [video.videoId]);
    await conn.query(`DELETE FROM playlistitems WHERE video_id = ?`, [video.id]);
    await conn.query(`DELETE FROM videosbyartist WHERE video_id = ? OR id = ?`, [video.id, video.id]);

    await conn.query(`DELETE FROM videos WHERE id = ?`, [video.id]);

    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function upsertQueue(videoId, proposedGenre, confidence, reason) {
  await pool.query(
    `INSERT INTO admin_genre_review_queue (video_id, proposed_genre, confidence, reason)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE proposed_genre = VALUES(proposed_genre), confidence = VALUES(confidence), reason = VALUES(reason), updated_at = UTC_TIMESTAMP(3)`,
    [videoId, proposedGenre, confidence, reason],
  );
}

async function run() {
  await ensureTables();

  const [[videoTotalRow]] = await pool.query(`SELECT COUNT(*) AS total FROM videos`);
  const totalVideos = Number(videoTotalRow?.total || 0);

  const currentState = await readState();
  let lastVideoId = Number(currentState?.last_video_id || 0);
  let processedCount = Number(currentState?.processed_count || 0);
  let updatedCount = Number(currentState?.updated_count || 0);
  let deletedCount = Number(currentState?.deleted_count || 0);
  let queuedCount = Number(currentState?.queued_count || 0);
  const startedAt = currentState?.started_at || new Date();

  await updateState({
    status: "running",
    total_videos: totalVideos,
    started_at: startedAt,
    last_message: `Resuming from video id ${lastVideoId}`,
  });

  console.log(`[genre-reclassify] Started. threshold=${CONFIDENCE_THRESHOLD} batch=${BATCH_SIZE} lastVideoId=${lastVideoId}`);
  console.log(`[genre-reclassify] totalVideos=${totalVideos} groq=${ENABLE_GROQ && GROQ_API_KEY ? "enabled" : "disabled"}`);

  let rowsSinceFlush = 0;

  while (true) {
    const batch = await fetchBatch(lastVideoId);

    if (batch.length === 0) {
      await updateState({
        status: "completed",
        last_message: "Completed full catalog pass",
      });
      console.log("[genre-reclassify] Completed full catalog pass.");
      break;
    }

    for (const video of batch) {
      let decision;
      try {
        const signals = await collectSignals(video);
        decision = chooseDecision(video, signals);

        if (decision.action === "delete") {
          await deleteVideoEverywhere(video);
          deletedCount += 1;
        } else if (decision.action === "update") {
          await pool.query(
            `UPDATE videos SET genre = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
            [decision.proposedGenre, video.id],
          );
          await pool.query(`DELETE FROM admin_genre_review_queue WHERE video_id = ?`, [video.videoId]);
          updatedCount += 1;
        } else {
          await upsertQueue(video.videoId, decision.proposedGenre, decision.confidence, decision.reason);
          queuedCount += 1;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await upsertQueue(video.videoId, null, 0, `worker-error:${msg.slice(0, 180)}`);
      }

      processedCount += 1;
      lastVideoId = Number(video.id);
      rowsSinceFlush += 1;

      if (rowsSinceFlush >= STATUS_FLUSH_EVERY) {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
        const rate = (processedCount / elapsedSec).toFixed(2);
        const pct = totalVideos > 0 ? ((processedCount / totalVideos) * 100).toFixed(2) : "0.00";
        const statusLine = `processed=${processedCount}/${totalVideos} (${pct}%) updated=${updatedCount} deleted=${deletedCount} queued=${queuedCount} rate=${rate}/s lastId=${lastVideoId}`;

        await updateState({
          status: "running",
          last_video_id: lastVideoId,
          processed_count: processedCount,
          updated_count: updatedCount,
          deleted_count: deletedCount,
          queued_count: queuedCount,
          total_videos: totalVideos,
          last_message: statusLine,
        });

        console.log(`[genre-reclassify] ${statusLine}`);
        rowsSinceFlush = 0;
      }
    }

    await sleep(50);
  }
}

run()
  .catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[genre-reclassify] fatal:", message);
    try {
      await updateState({ status: "error", last_message: message.slice(0, 500) });
    } catch {
      // ignore
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
