import { deriveAdminImportFallbackMetadata } from "@/lib/catalog-metadata-utils";
import { hasDatabaseUrl } from "@/lib/catalog-data-utils";
import { prisma } from "@/lib/db";
import { canonicalizeGenreLabel } from "@/lib/genre-buckets";
import { getMusicBrainzArtistData } from "@/lib/musicbrainz";
import { PLAYBACK_MIN_CONFIDENCE } from "@/lib/playback-config";

const ROCK_METAL_PATTERN = /\b(rock|metal|doom|death|black|thrash|sludge|stoner|hardcore|punk|grind|djent|nu metal|metalcore|post metal|heavy|prog|progressive|gothic|folk metal|power metal|industrial metal|symphonic metal)\b/i;
const PENDING_QUEUE_ENRICH_BATCH_LIMIT = Math.max(5, Math.min(100, Number(process.env.PENDING_QUEUE_ENRICH_BATCH_LIMIT || "30")));
const PENDING_QUEUE_ENRICH_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.PENDING_QUEUE_ENRICH_CONCURRENCY || "5")));

type GenreSignal = {
  source: string;
  genre: string;
  confidence: number;
};

export type GenreSuggestion = {
  proposedGenre: string | null;
  confidence: number;
  reason: string;
};

export type PendingQueueVideoRow = {
  videoId: string;
  title: string;
  genre: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
  channelTitle: string | null;
};

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
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "rock / metal" || normalized === "rock/metal";
}

export async function suggestGenreForVideo(videoId: string): Promise<GenreSuggestion> {
  if (!hasDatabaseUrl()) {
    return { proposedGenre: null, confidence: 0, reason: "no-database" };
  }

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
    try {
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
    } catch {
      // Best effort.
    }

    try {
      const mb = await getMusicBrainzArtistData(String(video.parsedArtist ?? ""));
      const mbGenre = normalizeGenreLabel(mb?.tags?.[0]);
      if (mbGenre) {
        const mbConfidence = mb?.isRockOrMetal ? 0.9 : 0.75;
        signals.push({ source: "musicbrainz", genre: mbGenre, confidence: mbConfidence });
      }
    } catch {
      // Best effort.
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

function needsPendingMetadataEnrichment(row: PendingQueueVideoRow) {
  const hasArtist = Boolean(row.parsedArtist?.trim());
  const hasTrack = Boolean(row.parsedTrack?.trim());
  return !hasArtist || !hasTrack;
}

function needsPendingGenreEnrichment(row: PendingQueueVideoRow) {
  return isGenericFallbackGenre(normalizeGenreLabel(row.genre));
}

async function enrichSinglePendingQueueVideo(row: PendingQueueVideoRow) {
  let touched = false;

  if (needsPendingMetadataEnrichment(row)) {
    const fallback = deriveAdminImportFallbackMetadata(row.title, row.channelTitle, PLAYBACK_MIN_CONFIDENCE);
    if (fallback) {
      await prisma.$executeRaw`
        UPDATE videos
        SET parsedArtist = COALESCE(NULLIF(parsedArtist, ''), ${fallback.artist}),
            parsedTrack = COALESCE(NULLIF(parsedTrack, ''), ${fallback.track}),
            parsedVideoType = COALESCE(NULLIF(parsedVideoType, ''), ${fallback.videoType}),
            parseMethod = COALESCE(NULLIF(parseMethod, ''), ${"pending-queue-heuristic"}),
            parseReason = COALESCE(NULLIF(parseReason, ''), ${fallback.reason}),
            parseConfidence = GREATEST(COALESCE(parseConfidence, 0), ${fallback.confidence}),
            parsedAt = COALESCE(parsedAt, ${new Date()}),
            updated_at = ${new Date()}
        WHERE videoId = ${row.videoId}
      `;
      touched = true;
    }
  }

  if (needsPendingGenreEnrichment(row)) {
    const suggestion = await suggestGenreForVideo(row.videoId);
    if (suggestion.proposedGenre && suggestion.confidence >= 0.75) {
      await prisma.$executeRaw`
        UPDATE videos
        SET genre = ${suggestion.proposedGenre},
            updated_at = ${new Date()}
        WHERE videoId = ${row.videoId}
          AND (genre IS NULL OR TRIM(genre) = '' OR LOWER(TRIM(genre)) IN ('rock / metal', 'rock/metal'))
      `;
      touched = true;
    }
  }

  return touched;
}

export async function enrichPendingQueueVideos(rows: PendingQueueVideoRow[]) {
  if (!hasDatabaseUrl() || rows.length === 0) return 0;

  const candidates = rows
    .filter((row) => needsPendingMetadataEnrichment(row) || needsPendingGenreEnrichment(row))
    .slice(0, PENDING_QUEUE_ENRICH_BATCH_LIMIT);

  if (candidates.length === 0) return 0;

  let touched = 0;
  let index = 0;

  const workers = Array.from({ length: Math.min(PENDING_QUEUE_ENRICH_CONCURRENCY, candidates.length) }, async () => {
    while (index < candidates.length) {
      const currentIndex = index;
      index += 1;

      const row = candidates[currentIndex];
      try {
        const didTouch = await enrichSinglePendingQueueVideo(row);
        if (didTouch) touched += 1;
      } catch {
        // Best effort; queue loading must never fail because of enrichment.
      }
    }
  });

  await Promise.all(workers);
  return touched;
}
