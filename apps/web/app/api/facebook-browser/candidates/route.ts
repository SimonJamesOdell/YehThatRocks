import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { safeErrorMessage } from "@/lib/api-error";

// ===========================================================================
// GET /api/facebook-browser/candidates
//
// Secure endpoint for the Linux Facebook browser posting script to fetch
// video candidates without direct database access. Authenticated via a
// shared secret (FB_BROWSER_API_SECRET).
//
// Query params:
//   mode    — "spotlight" | "versus" | "roundup"
//   secret  — shared API secret
//   count   — number of tracks for roundup mode (default: 5)
// ===========================================================================

function validateSecret(request: NextRequest): boolean {
  const expected = String(process.env.FB_BROWSER_API_SECRET || "").trim();
  if (!expected) return false;

  // Accept secret via query param or Authorization header.
  const fromQuery = request.nextUrl.searchParams.get("secret") || "";
  const fromHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";

  const provided = (fromQuery || fromHeader).trim();
  return provided === expected;
}

// ---------------------------------------------------------------------------
// Candidate queries
// ---------------------------------------------------------------------------

interface VideoCandidate {
  videoId: string;
  artist: string;
  title: string;
  genre: string;
  favourited: number;
}

async function getSpotlightCandidate(): Promise<VideoCandidate | null> {
  const pool = await prisma.video.findMany({
    where: {
      videoId: { not: "" },
      site_videos: { some: { status: "available" } },
    },
    orderBy: [{ favourited: "desc" }, { id: "desc" }],
    take: 600,
    select: {
      videoId: true,
      parsedArtist: true,
      parsedTrack: true,
      title: true,
      genreNorm: true,
      favourited: true,
    },
  });

  if (pool.length === 0) return null;

  // Weighted tier selection: top 120 = 55%, next 300 = 30%, rest = 15%.
  const tierA = pool.slice(0, 120);
  const tierB = pool.slice(120, 420);
  const tierC = pool.slice(420);

  const tiers = [
    { items: tierA, weight: 0.55 },
    { items: tierB, weight: 0.30 },
    { items: tierC, weight: 0.15 },
  ].filter((t) => t.items.length > 0);

  const totalWeight = tiers.reduce((sum, t) => sum + t.weight, 0);
  let cursor = Math.random() * totalWeight;
  let selected = tiers[0].items;

  for (const t of tiers) {
    cursor -= t.weight;
    if (cursor <= 0) {
      selected = t.items;
      break;
    }
  }

  const pick = selected[Math.floor(Math.random() * selected.length)] ?? pool[0];
  return mapCandidate(pick);
}

async function getVersusCandidates(): Promise<{ candidateA: VideoCandidate; candidateB: VideoCandidate } | null> {
  const pool = await prisma.video.findMany({
    where: {
      videoId: { not: "" },
      site_videos: { some: { status: "available" } },
    },
    orderBy: [{ favourited: "desc" }, { id: "desc" }],
    take: 600,
    select: {
      videoId: true,
      parsedArtist: true,
      parsedTrack: true,
      title: true,
      genreNorm: true,
      favourited: true,
    },
  });

  if (pool.length < 2) return null;

  // Pick A from top 30%.
  const topCutoff = Math.max(2, Math.floor(pool.length * 0.3));
  const topTier = pool.slice(0, topCutoff);
  const candidateA = topTier[Math.floor(Math.random() * topTier.length)];

  // Pick B from the rest, preferring a different genre.
  const rest = pool.filter((v) => v.videoId !== candidateA.videoId);
  const diffGenre = rest.filter(
    (v) => (v.genreNorm || "").toLowerCase() !== (candidateA.genreNorm || "").toLowerCase(),
  );
  const bPool = diffGenre.length > 0 ? diffGenre : rest;
  const candidateB = bPool[Math.floor(Math.random() * bPool.length)];

  if (!candidateB) return null;

  return {
    candidateA: mapCandidate(candidateA),
    candidateB: mapCandidate(candidateB),
  };
}

async function getRoundupCandidates(count: number): Promise<VideoCandidate[]> {
  const limit = Math.max(3, Math.min(count, 10));

  const tracks = await prisma.video.findMany({
    where: {
      videoId: { not: "" },
      site_videos: { some: { status: "available" } },
    },
    orderBy: [{ favourited: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      videoId: true,
      parsedArtist: true,
      parsedTrack: true,
      title: true,
      genreNorm: true,
      favourited: true,
    },
  });

  return tracks.map(mapCandidate);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCandidate(row: Record<string, unknown>): VideoCandidate {
  return {
    videoId: String(row.videoId || ""),
    artist: String(
      (row as { parsedArtist?: string | null }).parsedArtist ||
      (row as { artist?: string | null }).artist ||
      "Unknown artist",
    ),
    title: String(
      (row as { parsedTrack?: string | null }).parsedTrack ||
      (row as { title?: string | null }).title ||
      "Unknown track",
    ),
    genre: String((row as { genreNorm?: string | null }).genreNorm || "Rock / Metal"),
    favourited: Number((row as { favourited?: number }).favourited) || 0,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mode = (request.nextUrl.searchParams.get("mode") || "").toLowerCase();
  const rawCount = Number(request.nextUrl.searchParams.get("count") || "5");
  const count = Math.max(3, Math.min(10, Number.isFinite(rawCount) ? rawCount : 5));

  try {
    switch (mode) {
      case "spotlight": {
        const candidate = await getSpotlightCandidate();
        if (!candidate) {
          return NextResponse.json({ error: "no candidates available" }, { status: 404 });
        }
        return NextResponse.json({ candidate });
      }

      case "versus": {
        const pair = await getVersusCandidates();
        if (!pair) {
          return NextResponse.json({ error: "not enough candidates" }, { status: 404 });
        }
        return NextResponse.json(pair);
      }

      case "roundup": {
        const tracks = await getRoundupCandidates(count);
        return NextResponse.json({ tracks });
      }

      default:
        return NextResponse.json(
          { error: `unknown mode "${mode}". Valid: spotlight, versus, roundup` },
          { status: 400 },
        );
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "internal server error") }, { status: 500 });
  }
}
