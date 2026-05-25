import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withAuthAndBody } from "@/lib/api-route-pipeline";
import { prisma } from "@/lib/db";
import { canonicalizeGenreLabel } from "@/lib/genre-buckets";
import { getMusicBrainzArtistData } from "@/lib/musicbrainz";

const ROCK_METAL_PATTERN = /\b(rock|metal|doom|death|black|thrash|sludge|stoner|hardcore|punk|grind|djent|nu metal|metalcore|post metal|heavy|prog|progressive|gothic|folk metal|power metal|industrial metal|symphonic metal)\b/i;

type GenreSignal = {
  source: string;
  genre: string;
  confidence: number;
};

type GenreSuggestion = {
  proposedGenre: string | null;
  confidence: number;
  reason: string;
};

const autoGenreSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
});

function normalizeGenreLabel(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  return canonicalizeGenreLabel(trimmed.replace(/\s+/g, " "));
}

function normalizeArtistKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isGenericFallbackGenre(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "rock / metal" || normalized === "rock/metal";
}

async function suggestGenreForVideo(videoId: string): Promise<GenreSuggestion> {
  const videoRows = await prisma.$queryRawUnsafe<Array<{
    genre: string | null;
    parsedArtist: string | null;
  }>>(
    `SELECT genre, parsedArtist
     FROM videos
     WHERE videoId = ?
     LIMIT 1`,
    videoId,
  );

  const video = videoRows[0];
  if (!video) {
    return {
      proposedGenre: null,
      confidence: 0,
      reason: "no-video",
    };
  }

  const signals: GenreSignal[] = [];
  const existingGenre = normalizeGenreLabel(video.genre);
  if (existingGenre && !isGenericFallbackGenre(existingGenre)) {
    signals.push({ source: "video-existing", genre: existingGenre, confidence: 0.55 });
  }

  const normalizedArtist = normalizeArtistKey(video.parsedArtist);
  if (normalizedArtist) {
    const artistStatsRows = await prisma.$queryRawUnsafe<Array<{ genre: string | null }>>(
      `SELECT genre
       FROM artist_stats
       WHERE normalized_artist = ?
         AND genre IS NOT NULL
         AND TRIM(genre) <> ''
       LIMIT 1`,
      normalizedArtist,
    );

    const artistStatsGenre = normalizeGenreLabel(artistStatsRows[0]?.genre);
    if (artistStatsGenre) {
      signals.push({ source: "artist-stats", genre: artistStatsGenre, confidence: 0.86 });
    }

    const mb = await getMusicBrainzArtistData(String(video.parsedArtist ?? ""));
    const mbGenre = normalizeGenreLabel(mb?.tags?.[0]);
    if (mbGenre) {
      const mbConfidence = mb?.isRockOrMetal ? 0.9 : 0.75;
      signals.push({ source: "musicbrainz", genre: mbGenre, confidence: mbConfidence });
    }
  }

  if (signals.length === 0) {
    return {
      proposedGenre: null,
      confidence: 0,
      reason: "no-sources",
    };
  }

  const hasExternalSignal = signals.some((signal) => signal.source !== "video-existing");
  if (!hasExternalSignal) {
    return {
      proposedGenre: null,
      confidence: 0,
      reason: "insufficient-external-sources",
    };
  }

  const grouped = new Map<string, { genre: string; weight: number; support: number }>();
  let totalWeight = 0;

  for (const signal of signals) {
    const key = signal.genre.toLowerCase();
    const current = grouped.get(key) ?? { genre: signal.genre, weight: 0, support: 0 };
    current.weight += signal.confidence;
    current.support += 1;
    grouped.set(key, current);
    totalWeight += signal.confidence;
  }

  const ranked = Array.from(grouped.values()).sort((left, right) => (
    right.weight - left.weight || right.support - left.support
  ));
  const top = ranked[0];

  if (!top || totalWeight <= 0) {
    return {
      proposedGenre: null,
      confidence: 0,
      reason: "no-top-genre",
    };
  }

  let confidence = top.weight / totalWeight;
  if (top.support >= 2) {
    confidence += 0.08;
  }
  confidence = Math.max(0, Math.min(1, confidence));

  const normalizedTop = normalizeGenreLabel(top.genre);
  const isRockOrMetal = normalizedTop ? ROCK_METAL_PATTERN.test(normalizedTop) : false;

  if (confidence < 0.75) {
    return {
      proposedGenre: null,
      confidence,
      reason: `manual-review:${normalizedTop ?? "unknown"}`,
    };
  }

  const reasonPrefix = confidence >= 0.9
    ? (isRockOrMetal ? "high-confidence-update" : "high-confidence-non-rock")
    : "manual-review";

  return {
    proposedGenre: normalizedTop,
    confidence,
    reason: `${reasonPrefix}:${normalizedTop ?? "unknown"}`,
  };
}

export async function POST(request: NextRequest) {
  const result = await withAuthAndBody(request, autoGenreSchema, {
    authMode: "admin",
    adminPermission: "admin.videos.pending.moderate",
  });

  if (!result.ok) {
    return result.response;
  }

  const { videoId } = result.data;
  const suggestion = await suggestGenreForVideo(videoId);

  return NextResponse.json({
    ok: true,
    videoId,
    suggestion,
  });
}
