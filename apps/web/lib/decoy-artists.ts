/**
 * Deterministic synthetic catalog generator for the decoy / honeypot defense.
 *
 * The catalog walker enumerates artists alphabetically and harvests
 * artist<->video mappings. These helpers materialise an effectively infinite
 * space of plausible-looking fake artists and fake video IDs without any
 * database rows, so we can hand the scraper a never-ending catalog of
 * nonsense to chew on.
 *
 * Everything here is pure and deterministic: the same inputs always produce
 * the same output, so responses are stable and (if we ever want to) cheap to
 * cache. No database access, no randomness, no side effects.
 */

export const DECOY_VIDEO_ID_PREFIX = "d3c0";
export const DECOY_VIDEO_ID_LENGTH = 11;
export const DECOY_VIDEOS_PER_ARTIST = 12;

const FIRST_WORDS = [
  "Iron", "Steel", "Raven", "Crimson", "Obsidian", "Thunder", "Wraith", "Ashen",
  "Feral", "Lunar", "Venom", "Static", "Bleak", "Cinder", "Grave", "Hollow",
  "Morbid", "Ritual", "Vermin", "Wretched", "Silent", "Frozen", "Savage", "Dying",
];

const SECOND_WORDS = [
  "Horizon", "Requiem", "Serpent", "Omen", "Cathedral", "Monolith", "Revenant",
  "Abyss", "Havoc", "Coven", "Empire", "Oracle", "Mausoleum", "Vigil", "Tyrant",
  "Descent", "Onslaught", "Rapture", "Sepulchre", "Wasteland", "Procession",
  "Throne", "Elegy", "Pariah",
];

const TRACK_WORDS = [
  "Crown", "Gates", "Serpentine", "Hollow", "Embers", "Requiem", "Vulture",
  "Ashes", "Obsidian", "Ritual", "Nocturne", "Collapse", "Halo", "Fever",
  "Martyr", "Wasteland", "Eclipse", "Sorrow", "Kingdom", "Vertigo",
];

const GENRES = [
  "Black Metal", "Death Metal", "Doom Metal", "Thrash Metal", "Progressive Rock",
  "Stoner Rock", "Gothic Metal", "Symphonic Metal", "Sludge Metal", "Hard Rock",
  "Post-Metal", "Metalcore",
];

const COUNTRIES = [
  "Finland", "Sweden", "Norway", "Germany", "United States", "United Kingdom",
  "Iceland", "Poland", "France", "Greece", "Brazil", "Australia",
];

export type DecoyArtist = {
  slug: string;
  name: string;
  genre: string;
  country: string;
  thumbnailVideoId: string;
  videoIds: string[];
};

export type DecoyVideoMetadata = {
  id: string;
  title: string;
  channelTitle: string;
  genre: string | null;
  parsedArtist: string | null;
  parsedTrack: string | null;
};

/** True when a video ID was manufactured by this generator (never a real YouTube ID). */
export function isDecoyVideoId(videoId: string | null | undefined): boolean {
  if (!videoId) return false;
  return (
    videoId.startsWith(DECOY_VIDEO_ID_PREFIX)
    && videoId.length === DECOY_VIDEO_ID_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(videoId)
  );
}

/** FNV-1a 32-bit string hash. */
function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, deterministic PRNG. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)] as T;
}

function slugifyLocal(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/** A fake 11-char video ID derived from a seed. Deterministic. */
export function decoyVideoId(seed: string, n: number): string {
  const rng = createRng(hashSeed(`${seed}:${n}`));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let id = DECOY_VIDEO_ID_PREFIX;
  for (let i = 0; i < DECOY_VIDEO_ID_LENGTH - DECOY_VIDEO_ID_PREFIX.length; i += 1) {
    id += alphabet.charAt(Math.floor(rng() * alphabet.length));
  }
  return id;
}

/** A plausible decoy slug for the (letter, index) slot in the alphabetical walk. */
export function decoySlugFor(letter: string, index: number): string {
  const normalized = letter === "#" ? "num" : letter.toLowerCase();
  const rng = createRng(hashSeed(`slug:${normalized}:${index}`));
  const first = pick(rng, FIRST_WORDS);
  const second = pick(rng, SECOND_WORDS);
  const number = Math.floor(rng() * 90) + 10;
  return slugifyLocal(`${first} ${second} ${number}`);
}

/** Build the full decoy artist record for a slug. Deterministic. */
export function buildDecoyArtist(slug: string): DecoyArtist {
  const rng = createRng(hashSeed(`artist:${slug}`));
  const name = titleCaseSlug(slug);
  const genre = pick(rng, GENRES);
  const country = pick(rng, COUNTRIES);
  const thumbnailVideoId = decoyVideoId(`thumb:${slug}`, 0);
  const videoIds = Array.from({ length: DECOY_VIDEOS_PER_ARTIST }, (_, i) => decoyVideoId(`videos:${slug}`, i));
  return { slug, name, genre, country, thumbnailVideoId, videoIds };
}

/** Synthetic share-preview metadata for a manufactured video ID. */
export function decoyVideoMetadata(videoId: string): DecoyVideoMetadata {
  const rng = createRng(hashSeed(`meta:${videoId}`));
  const artist = `${pick(rng, FIRST_WORDS)} ${pick(rng, SECOND_WORDS)}`;
  const track = pick(rng, TRACK_WORDS);
  return {
    id: videoId,
    title: `${artist} — ${track}`,
    channelTitle: artist,
    genre: pick(rng, GENRES),
    parsedArtist: artist,
    parsedTrack: track,
  };
}

/**
 * Build a JSON array of decoy artists until the serialised output is roughly
 * `targetBytes` long. Used to answer a confident walker with one big blob of
 * fake catalog instead of letting it page through real pages.
 */
export function buildDecoyCatalogDump(targetBytes: number): string {
  const letters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  const artists: DecoyArtist[] = [];
  let size = 2; // "[]"
  let index = 0;

  while (size < targetBytes && index < 1_000_000) {
    const letter = letters[index % letters.length] as string;
    const round = Math.floor(index / letters.length);
    const artist = buildDecoyArtist(decoySlugFor(letter, round));
    const chunk = JSON.stringify(artist);
    size += chunk.length + 1; // +1 for the comma
    artists.push(artist);
    index += 1;
  }

  return JSON.stringify(artists);
}
