"use strict";

const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key]) {
      continue;
    }

    process.env[key] = rawValue.replace(/^"/, "").replace(/"$/, "");
  }
}

function loadEnv() {
  loadEnvFile(path.resolve(process.cwd(), "apps/web/.env.local"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toSafeNumber(value, fallback = 0) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {
      posts: [],
      lastRunAt: null,
    };
  }

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : null,
    };
  } catch {
    return {
      posts: [],
      lastRunAt: null,
    };
  }
}

function writeState(statePath, state) {
  ensureDirFor(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

function pickWeightedCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const tierA = candidates.slice(0, 120);
  const tierB = candidates.slice(120, 420);
  const tierC = candidates.slice(420);

  const availableTiers = [
    { tier: tierA, weight: 0.55 },
    { tier: tierB, weight: 0.30 },
    { tier: tierC, weight: 0.15 },
  ].filter((entry) => entry.tier.length > 0);

  if (availableTiers.length === 0) {
    return null;
  }

  const totalWeight = availableTiers.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;
  let selectedTier = availableTiers[0].tier;

  for (const entry of availableTiers) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      selectedTier = entry.tier;
      break;
    }
  }

  const pickIndex = Math.floor(Math.random() * selectedTier.length);
  return selectedTier[pickIndex] ?? candidates[0] ?? null;
}

async function getTopPlayableCandidates(prisma, poolSize) {
  const limit = Math.max(50, Math.min(poolSize, 2000));

  const videoColumns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM videos");
  const columnSet = new Set(videoColumns.map((col) => String(col.Field || "").trim()));

  const artistExpr = columnSet.has("parsedArtist")
    ? "COALESCE(NULLIF(TRIM(v.parsedArtist), ''), 'Unknown artist')"
    : "'Unknown artist'";
  const titleExpr = columnSet.has("parsedTrack")
    ? "COALESCE(NULLIF(TRIM(v.parsedTrack), ''), NULLIF(TRIM(v.title), ''), 'Unknown track')"
    : "COALESCE(NULLIF(TRIM(v.title), ''), 'Unknown track')";
  const genreExpr = columnSet.has("genre")
    ? "COALESCE(NULLIF(TRIM(v.genre), ''), 'Rock / Metal')"
    : "'Rock / Metal'";
  const favouritedExpr = columnSet.has("favourited") ? "COALESCE(v.favourited, 0)" : "0";

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        v.videoId AS videoId,
        ${artistExpr} AS artist,
        ${titleExpr} AS title,
        ${genreExpr} AS genre,
        ${favouritedExpr} AS favourited,
        v.id AS internalId
      FROM videos v
      INNER JOIN (SELECT DISTINCT sv.video_id FROM site_videos sv WHERE sv.status = 'available') sv_avail ON sv_avail.video_id = v.id
      WHERE v.videoId IS NOT NULL
      ORDER BY ${favouritedExpr} DESC, v.id DESC
      LIMIT ?
    `,
    limit,
  );

  return rows
    .map((row) => ({
      videoId: String(row.videoId || "").trim(),
      artist: String(row.artist || "Unknown artist"),
      title: String(row.title || "Unknown track"),
      genre: String(row.genre || "Rock / Metal"),
      favourited: toSafeNumber(row.favourited, 0),
      internalId: toSafeNumber(row.internalId, 0),
    }))
    .filter((row) => row.videoId.length > 0);
}

// ---------------------------------------------------------------------------
// Versus mode — two contrasting candidates
// ---------------------------------------------------------------------------

/**
 * Pick two contrasting videos from the playable pool. Uses the same
 * popularity-sorted pool as getTopPlayableCandidates but selects two
 * candidates from different tiers to create an interesting head-to-head.
 */
async function getVersusCandidates(prisma, poolSize = 600) {
  const pool = await getTopPlayableCandidates(prisma, poolSize);
  if (pool.length < 2) {
    return null;
  }

  // Pick candidate A from the top tier (first 30% of pool).
  const topCutoff = Math.max(2, Math.floor(pool.length * 0.3));
  const topTier = pool.slice(0, topCutoff);
  const idxA = Math.floor(Math.random() * topTier.length);
  const candidateA = topTier[idxA];

  // Pick candidate B from the rest of the pool (different genre preferred).
  const restPool = pool.filter((v) => v.videoId !== candidateA.videoId);
  if (restPool.length === 0) {
    return null;
  }

  // Prefer a different genre for contrast.
  const differentGenre = restPool.filter(
    (v) => String(v.genre || "").toLowerCase() !== String(candidateA.genre || "").toLowerCase(),
  );
  const bPool = differentGenre.length > 0 ? differentGenre : restPool;
  const idxB = Math.floor(Math.random() * bPool.length);
  const candidateB = bPool[idxB];

  return { candidateA, candidateB };
}

// ---------------------------------------------------------------------------
// Roundup mode — top N
// ---------------------------------------------------------------------------

/**
 * Fetch the top `count` playable videos by favourited count for a weekly
 * or daily roundup post.
 */
async function getRoundupCandidates(prisma, count = 5) {
  const limit = Math.max(3, Math.min(count, 10));
  return getTopPlayableCandidates(prisma, limit);
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// HTTP-based candidates (for Linux box without direct DB access)
// ---------------------------------------------------------------------------

/**
 * Fetch a single spotlight candidate from the secure API endpoint.
 * Used when DATABASE_URL is not available but FB_BROWSER_API_URL + secret are set.
 */
async function fetchSpotlightCandidate(apiUrl, secret) {
  const url = new URL(trimTrailingSlash(apiUrl) + "/api/facebook-browser/candidates");
  url.searchParams.set("mode", "spotlight");
  url.searchParams.set("secret", secret);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.candidate || null;
}

/**
 * Fetch a versus pair from the secure API endpoint.
 */
async function fetchVersusCandidates(apiUrl, secret) {
  const url = new URL(trimTrailingSlash(apiUrl) + "/api/facebook-browser/candidates");
  url.searchParams.set("mode", "versus");
  url.searchParams.set("secret", secret);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  if (!data.candidateA || !data.candidateB) return null;
  return { candidateA: data.candidateA, candidateB: data.candidateB };
}

/**
 * Fetch roundup tracks from the secure API endpoint.
 */
async function fetchRoundupCandidates(apiUrl, secret, count = 5) {
  const url = new URL(trimTrailingSlash(apiUrl) + "/api/facebook-browser/candidates");
  url.searchParams.set("mode", "roundup");
  url.searchParams.set("secret", secret);
  url.searchParams.set("count", String(count));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  return Array.isArray(data.tracks) ? data.tracks : [];
}

module.exports = {
  loadEnvFile,
  loadEnv,
  toPositiveInt,
  toSafeNumber,
  ensureDirFor,
  readState,
  writeState,
  pickWeightedCandidate,
  getTopPlayableCandidates,
  getVersusCandidates,
  getRoundupCandidates,
  fetchSpotlightCandidate,
  fetchVersusCandidates,
  fetchRoundupCandidates,
};
