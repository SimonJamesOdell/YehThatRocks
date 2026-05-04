/**
 * musicbrainz.ts
 * Rate-limited, in-process-cached MusicBrainz artist lookup for classification support.
 *
 * MusicBrainz rate limits:
 *   - Anonymous: 1 request/second
 *   - With MUSICBRAINZ_APP_NAME set: up to 5 requests/second (registered app)
 *
 * We fetch: tags (genre votes), disambiguation (plain-text genre description), and
 * the canonical artist name. Results are cached in-process for 24 hours.
 *
 * The returned data is used in the video classification pipeline to:
 *   - Confirm or deny rock/metal genre alignment
 *   - Boost or penalise confidence accordingly
 */

import { BoundedMap } from "@/lib/bounded-map";
import { slugifyArtistName } from "@/lib/artist-routing";

// ── Configuration ─────────────────────────────────────────────────────────────

const APP_NAME = process.env.MUSICBRAINZ_APP_NAME || "YehThatRocks/1.0";
const APP_CONTACT = process.env.MUSICBRAINZ_APP_CONTACT || "https://yehthatrocks.com";
const REQUESTS_PER_SECOND = 1; // stay conservative; 1/s is always safe for anonymous + named apps
const REQUEST_INTERVAL_MS = Math.ceil(1000 / REQUESTS_PER_SECOND);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_ENTRIES = 2_000;
const FETCH_TIMEOUT_MS = 5_000;

// ── Rock/metal genre detection ────────────────────────────────────────────────

const ROCK_METAL_TAG_PATTERN =
  /\b(rock|metal|grunge|punk|hardcore|doom|thrash|death|black metal|heavy|progressive|stoner|sludge|post-rock|post-metal|industrial|gothic|power metal|folk metal|pagan|viking|melodic|djent|nu.?metal|emo|screamo|alternative)\b/i;

const NON_MUSIC_TAG_PATTERN =
  /\b(pop|hip.?hop|rap|r&b|soul|country|classical|jazz|folk|electronic|dance|edm|techno|house|ambient|gospel|latin|reggae|ska)\b/i;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MusicBrainzArtistResult = {
  canonicalName: string | null;
  disambiguation: string | null;
  tags: string[];
  isRockOrMetal: boolean;
  /** true only when the result is explicitly non-rock/metal (not just unknown) */
  isDefinitelyNotRockOrMetal: boolean;
  mbid: string | null;
};

type CacheEntry = {
  expiresAt: number;
  result: MusicBrainzArtistResult;
};

type MusicBrainzApiArtist = {
  id?: string;
  name?: string;
  disambiguation?: string;
  score?: number;
  tags?: Array<{ name: string; count: number }>;
};

// ── Rate limiter ──────────────────────────────────────────────────────────────

let lastRequestAt = 0;
const pendingQueue: Array<() => void> = [];
let queueRunning = false;

function drainQueue() {
  if (queueRunning) return;
  queueRunning = true;

  const next = () => {
    const resolve = pendingQueue.shift();
    if (!resolve) {
      queueRunning = false;
      return;
    }

    const now = Date.now();
    const waitMs = Math.max(0, lastRequestAt + REQUEST_INTERVAL_MS - now);

    setTimeout(() => {
      lastRequestAt = Date.now();
      resolve();
      next();
    }, waitMs);
  };

  next();
}

function acquireRateLimit(): Promise<void> {
  return new Promise((resolve) => {
    pendingQueue.push(resolve);
    drainQueue();
  });
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const cache = new BoundedMap<string, CacheEntry>(CACHE_MAX_ENTRIES);

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLikelyMatch(queryName: string, candidateName: string): boolean {
  const q = slugifyArtistName(queryName);
  const c = slugifyArtistName(candidateName);
  if (!q || !c) return false;
  return q === c || q.includes(c) || c.includes(q);
}

function extractRockMetalSignal(tags: string[], disambiguation: string | null): {
  isRockOrMetal: boolean;
  isDefinitelyNotRockOrMetal: boolean;
} {
  const allText = [disambiguation ?? "", ...tags].join(" ").toLowerCase();

  if (!allText.trim()) {
    return { isRockOrMetal: false, isDefinitelyNotRockOrMetal: false };
  }

  const rockOrMetal = ROCK_METAL_TAG_PATTERN.test(allText);
  const nonMusic = !rockOrMetal && NON_MUSIC_TAG_PATTERN.test(allText);

  return {
    isRockOrMetal: rockOrMetal,
    isDefinitelyNotRockOrMetal: nonMusic,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Look up an artist on MusicBrainz and return genre signals useful for
 * classification confidence adjustment. Results are in-process cached for 24h.
 *
 * Never throws — returns null on any error or timeout.
 */
export async function getMusicBrainzArtistData(
  artistName: string,
): Promise<MusicBrainzArtistResult | null> {
  const normalized = artistName.trim().toLowerCase();
  if (!normalized || normalized.length < 2) return null;

  const now = Date.now();
  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > now) return cached.result;

  try {
    await acquireRateLimit();

    const url = new URL("https://musicbrainz.org/ws/2/artist/");
    url.searchParams.set("query", `artist:${artistName}`);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("inc", "tags");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          "User-Agent": `${APP_NAME} ( ${APP_CONTACT} )`,
          Accept: "application/json",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as {
      artists?: MusicBrainzApiArtist[];
    } | null;

    const artist = payload?.artists?.[0];
    if (!artist?.id || !artist.name) {
      const empty: MusicBrainzArtistResult = {
        canonicalName: null,
        disambiguation: null,
        tags: [],
        isRockOrMetal: false,
        isDefinitelyNotRockOrMetal: false,
        mbid: null,
      };
      cache.set(normalized, { expiresAt: now + CACHE_TTL_MS, result: empty });
      return empty;
    }

    if (!isLikelyMatch(artistName, artist.name)) {
      const empty: MusicBrainzArtistResult = {
        canonicalName: null,
        disambiguation: null,
        tags: [],
        isRockOrMetal: false,
        isDefinitelyNotRockOrMetal: false,
        mbid: null,
      };
      cache.set(normalized, { expiresAt: now + CACHE_TTL_MS, result: empty });
      return empty;
    }

    const tags = (artist.tags ?? [])
      .sort((a, b) => b.count - a.count)
      .map((t) => t.name.trim().toLowerCase())
      .filter(Boolean);

    const disambiguation = artist.disambiguation?.trim() || null;
    const { isRockOrMetal, isDefinitelyNotRockOrMetal } = extractRockMetalSignal(tags, disambiguation);

    const result: MusicBrainzArtistResult = {
      canonicalName: artist.name.trim(),
      disambiguation,
      tags,
      isRockOrMetal,
      isDefinitelyNotRockOrMetal,
      mbid: artist.id,
    };

    cache.set(normalized, { expiresAt: now + CACHE_TTL_MS, result });
    return result;
  } catch {
    return null;
  }
}
