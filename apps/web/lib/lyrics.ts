import { getVideoForSharing, normalizeYouTubeVideoId } from "@/lib/catalog-data";
import { prisma } from "@/lib/db";

type LyricsSearchRecord = {
  id?: number;
  trackName?: string;
  artistName?: string;
  plainLyrics?: string;
  instrumental?: boolean;
};

type LyricsFetchResult =
  | {
      state: "found";
      plainLyrics: string;
      source: "lrclib";
      sourceRecordId: number | null;
    }
  | {
      state: "not-found";
    }
  | {
      state: "fetch-error";
      status?: number;
    };

export type LyricsLookupResult = {
  ok: boolean;
  status: number;
  videoId?: string;
  artistName?: string;
  trackName?: string;
  plainLyrics?: string;
  source?: string;
  cached?: boolean;
  message?: string;
};

function normalizeSignatureToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeMetadataToken(value: string | null | undefined, maxLength = 255) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(official\s+video|official|lyrics?|lyric\s+video|audio|visualizer|hd|4k|remaster(?:ed)?|live)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function deriveArtistTrackFromTitle(title: string, channelTitle: string | null | undefined) {
  const simpleSplit = title
    .split(/\s+-\s+|\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (simpleSplit.length >= 2) {
    const artist = sanitizeMetadataToken(simpleSplit[0]);
    const track = sanitizeMetadataToken(simpleSplit[1]);
    if (artist && track) {
      return { artistName: artist, trackName: track };
    }
  }

  const artistFallback = sanitizeMetadataToken(channelTitle ?? "");
  const trackFallback = sanitizeMetadataToken(title);

  if (artistFallback && trackFallback) {
    return { artistName: artistFallback, trackName: trackFallback };
  }

  return null;
}

function pickBestLyricsRecord(records: LyricsSearchRecord[], artistName: string, trackName: string) {
  const normalizedArtist = normalizeSignatureToken(artistName);
  const normalizedTrack = normalizeSignatureToken(trackName);

  const withLyrics = records.filter((record) => {
    return typeof record.plainLyrics === "string" && record.plainLyrics.trim().length > 0;
  });

  if (withLyrics.length === 0) {
    return null;
  }

  const exact = withLyrics.find((record) => {
    const candidateArtist = normalizeSignatureToken(record.artistName ?? "");
    const candidateTrack = normalizeSignatureToken(record.trackName ?? "");
    return candidateArtist === normalizedArtist && candidateTrack === normalizedTrack;
  });

  if (exact) {
    return exact;
  }

  const trackExact = withLyrics.find((record) => {
    const candidateTrack = normalizeSignatureToken(record.trackName ?? "");
    return candidateTrack === normalizedTrack;
  });

  return trackExact ?? withLyrics[0];
}

async function fetchLyricsFromLrclib(artistName: string, trackName: string): Promise<LyricsFetchResult> {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("artist_name", artistName);
  url.searchParams.set("track_name", trackName);

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "YehThatRocks/1.0 (+https://yehthatrocks.com)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return { state: "fetch-error", status: response.status };
  }

  const payload = (await response.json().catch(() => null)) as LyricsSearchRecord[] | null;
  if (!payload) {
    return { state: "fetch-error" };
  }

  const records = Array.isArray(payload) ? payload : [];
  const candidate = pickBestLyricsRecord(records, artistName, trackName);

  if (!candidate?.plainLyrics) {
    return { state: "not-found" };
  }

  return {
    state: "found",
    plainLyrics: candidate.plainLyrics.trim(),
    source: "lrclib",
    sourceRecordId: typeof candidate.id === "number" ? candidate.id : null,
  };
}

export async function getLyricsForVideo(videoId?: string | null): Promise<LyricsLookupResult> {
  const normalizedVideoId = normalizeYouTubeVideoId(videoId);
  if (!normalizedVideoId) {
    return {
      ok: false,
      status: 400,
      message: "Invalid video id",
    };
  }

  const dbVideo = await prisma.video.findUnique({
    where: { videoId: normalizedVideoId },
    select: {
      title: true,
      channelTitle: true,
      parsedArtist: true,
      parsedTrack: true,
    },
  }).catch(() => null);

  const fallbackVideo = dbVideo
    ? null
    : await getVideoForSharing(normalizedVideoId).catch(() => null);

  const title = (dbVideo?.title ?? fallbackVideo?.title ?? "").trim();
  const channelTitle = (dbVideo?.channelTitle ?? fallbackVideo?.channelTitle ?? "").trim() || null;
  const parsedArtist = sanitizeMetadataToken(dbVideo?.parsedArtist ?? null);
  const parsedTrack = sanitizeMetadataToken(dbVideo?.parsedTrack ?? null);

  const derived = parsedArtist && parsedTrack
    ? { artistName: parsedArtist, trackName: parsedTrack }
    : deriveArtistTrackFromTitle(title, channelTitle);

  if (!derived) {
    return {
      ok: true,
      status: 200,
      videoId: normalizedVideoId,
      message: "No lyrics available for this track.",
      plainLyrics: undefined,
      source: "metadata-unavailable",
      cached: false,
    };
  }

  const normalizedArtist = normalizeSignatureToken(derived.artistName);
  const normalizedTrack = normalizeSignatureToken(derived.trackName);

  const cached = await prisma.lyricsCache.findUnique({
    where: {
      normalizedArtist_normalizedTrack: {
        normalizedArtist,
        normalizedTrack,
      },
    },
  }).catch(() => null);

  if (cached) {
    if (cached.isUnavailable || !cached.lyrics) {
      return {
        ok: true,
        status: 200,
        videoId: normalizedVideoId,
        artistName: cached.artistName,
        trackName: cached.trackName,
        source: cached.source ?? "cache",
        cached: true,
        message: "No lyrics available for this track.",
      };
    }

    return {
      ok: true,
      status: 200,
      videoId: normalizedVideoId,
      artistName: cached.artistName,
      trackName: cached.trackName,
      plainLyrics: cached.lyrics,
      source: cached.source ?? "cache",
      cached: true,
    };
  }

  const fetched = await fetchLyricsFromLrclib(derived.artistName, derived.trackName).catch(() => ({ state: "fetch-error" as const }));

  if (fetched.state === "fetch-error") {
    return {
      ok: false,
      status: 502,
      videoId: normalizedVideoId,
      artistName: derived.artistName,
      trackName: derived.trackName,
      message: "Could not fetch lyrics from the provider right now. Please try again shortly.",
      source: "lrclib",
      cached: false,
    };
  }

  if (fetched.state === "not-found") {
    await prisma.lyricsCache.upsert({
      where: {
        normalizedArtist_normalizedTrack: {
          normalizedArtist,
          normalizedTrack,
        },
      },
      create: {
        artistName: derived.artistName,
        trackName: derived.trackName,
        normalizedArtist,
        normalizedTrack,
        lyrics: null,
        source: "lrclib",
        sourceRecordId: null,
        isInstrumental: false,
        isUnavailable: true,
      },
      update: {
        artistName: derived.artistName,
        trackName: derived.trackName,
        lyrics: null,
        source: "lrclib",
        sourceRecordId: null,
        isInstrumental: false,
        isUnavailable: true,
      },
    }).catch(() => undefined);

    return {
      ok: true,
      status: 200,
      videoId: normalizedVideoId,
      artistName: derived.artistName,
      trackName: derived.trackName,
      source: "lrclib",
      cached: false,
      message: "No lyrics available for this track.",
    };
  }

  await prisma.lyricsCache.upsert({
    where: {
      normalizedArtist_normalizedTrack: {
        normalizedArtist,
        normalizedTrack,
      },
    },
    create: {
      artistName: derived.artistName,
      trackName: derived.trackName,
      normalizedArtist,
      normalizedTrack,
      lyrics: fetched.plainLyrics,
      source: fetched.source,
      sourceRecordId: fetched.sourceRecordId,
      isInstrumental: false,
      isUnavailable: false,
    },
    update: {
      artistName: derived.artistName,
      trackName: derived.trackName,
      lyrics: fetched.plainLyrics,
      source: fetched.source,
      sourceRecordId: fetched.sourceRecordId,
      isInstrumental: false,
      isUnavailable: false,
    },
  }).catch(() => undefined);

  return {
    ok: true,
    status: 200,
    videoId: normalizedVideoId,
    artistName: derived.artistName,
    trackName: derived.trackName,
    plainLyrics: fetched.plainLyrics,
    source: fetched.source,
    cached: false,
  };
}
