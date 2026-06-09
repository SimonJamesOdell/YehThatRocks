import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeYouTubeVideoId } from "@/lib/catalog-data";

function sanitizeMetadataToken(value: string | null | undefined, maxLength = 255): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function normalizeSignatureToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type LyricsCandidate = {
  artistName: string;
  trackName: string;
};

function deriveArtistTrackFromTitle(
  title: string,
  channelTitle: string | null,
): { artistName: string | null; trackName: string | null } | null {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return null;

  const separators = [" - ", " — ", " | "];
  for (const separator of separators) {
    const split = trimmedTitle.split(separator).map((part) => part.trim()).filter(Boolean);
    if (split.length < 2) continue;
    const [left, right] = split;
    if (channelTitle && left.toLowerCase() === channelTitle.toLowerCase()) {
      return { artistName: left, trackName: right };
    }
    if (channelTitle && right.toLowerCase() === channelTitle.toLowerCase()) {
      return { artistName: right, trackName: left };
    }
    return { artistName: left, trackName: right };
  }

  return null;
}

function buildLyricsCandidates(
  parsedArtist: string | null,
  parsedTrack: string | null,
  title: string,
  channelTitle: string | null,
): LyricsCandidate[] {
  const candidates: LyricsCandidate[] = [];
  const signatures = new Set<string>();

  const addCandidate = (artistName: string | null, trackName: string | null) => {
    if (!artistName || !trackName) return;
    const artist = sanitizeMetadataToken(artistName);
    const track = sanitizeMetadataToken(trackName);
    if (!artist || !track) return;
    const signature = `${normalizeSignatureToken(artist)}::${normalizeSignatureToken(track)}`;
    if (signatures.has(signature)) return;
    signatures.add(signature);
    candidates.push({ artistName: artist, trackName: track });
  };

  addCandidate(parsedArtist, parsedTrack);
  const fromTitle = deriveArtistTrackFromTitle(title, channelTitle);
  addCandidate(fromTitle?.artistName ?? null, fromTitle?.trackName ?? null);
  addCandidate(parsedTrack, parsedArtist);

  return candidates;
}

// Lightweight check: queries only the local DB cache, never calls LRCLIB.
// Returns {available: true} if a cached lyric exists for this video's artist/track.
export async function GET(request: NextRequest) {
  const rawVideoId = request.nextUrl.searchParams.get("v");
  const normalizedVideoId = normalizeYouTubeVideoId(rawVideoId);

  if (!normalizedVideoId) {
    return NextResponse.json({ available: false });
  }

  try {
    // Look up video metadata
    const dbVideo = await prisma.video.findUnique({
      where: { videoId: normalizedVideoId },
      select: { title: true, channelTitle: true, parsedArtist: true, parsedTrack: true },
    }).catch(() => null);

    if (!dbVideo) {
      // No video metadata available — can't determine artist/track
      return NextResponse.json({ available: false });
    }

    const title = (dbVideo.title ?? "").trim();
    const channelTitle = (dbVideo.channelTitle ?? "").trim() || null;
    const parsedArtist = sanitizeMetadataToken(dbVideo.parsedArtist ?? null);
    const parsedTrack = sanitizeMetadataToken(dbVideo.parsedTrack ?? null);

    const candidates = buildLyricsCandidates(parsedArtist, parsedTrack, title, channelTitle);

    // Check cache for each candidate — stop at first hit
    for (const candidate of candidates) {
      const normalizedArtist = normalizeSignatureToken(candidate.artistName);
      const normalizedTrack = normalizeSignatureToken(candidate.trackName);

      const cached = await prisma.lyricsCache.findUnique({
        where: {
          normalizedArtist_normalizedTrack: { normalizedArtist, normalizedTrack },
        },
        select: { lyrics: true, isUnavailable: true },
      }).catch(() => null);

      if (cached && !cached.isUnavailable && cached.lyrics) {
        return NextResponse.json({ available: true });
      }
    }

    return NextResponse.json({ available: false });
  } catch {
    return NextResponse.json({ available: false });
  }
}
