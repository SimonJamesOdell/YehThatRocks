/**
 * forum-data.ts
 * Forum thread and post database access, with seed data fallback.
 */

import { prisma } from "@/lib/db";
import { FORUM_SECTIONS } from "@/lib/forum-sections";
import { getStoredVideoById } from "@/lib/catalog-data-db";
import { mapVideo } from "@/lib/catalog-data-utils";

// ── Types ─────────────────────────────────────────────────────────────────

export type ForumThreadSummary = {
  id: number;
  sectionId: string;
  sectionTitle: string;
  title: string;
  userId: number;
  userScreenName: string;
  userAvatarUrl: string | null;
  postCount: number;
  viewCount: number;
  video1Id: string | null;
  video2Id: string | null;
  latestPostAt: Date | null;
  isPinned: boolean;
  isLocked: boolean;
  createdAt: Date;
};

export type ForumPostDetail = {
  id: number;
  threadId: number;
  userId: number;
  userScreenName: string;
  userAvatarUrl: string | null;
  content: string;
  createdAt: Date;
};

export type ThreadVoteCounts = {
  votes1: number;
  votes2: number;
};

export type ForumThreadDetail = {
  thread: ForumThreadSummary;
  posts: ForumPostDetail[];
  voteCounts?: ThreadVoteCounts | null;
  userVote?: number | null;
};

// ── Raw DB row types ───────────────────────────────────────────────────────

type RawThreadRow = {
  id: number;
  section_id: string;
  title: string;
  user_id: number;
  screen_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_pinned: number | boolean;
  is_locked: number | boolean;
  view_count: number;
  video1_id: string | null;
  video2_id: string | null;
  created_at: Date;
  updated_at: Date;
  post_count: number | bigint;
  latest_post_at: Date | null;
};

type RawPostRow = {
  id: number;
  thread_id: number;
  user_id: number;
  screen_name: string | null;
  email: string | null;
  avatar_url: string | null;
  content: string;
  created_at: Date;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveScreenName(
  screenName: string | null,
  email: string | null,
  userId: number,
): string {
  if (screenName) return screenName;
  if (email && email.includes("@")) return email.split("@")[0];
  return `user-${userId}`;
}

function resolveSectionTitle(sectionId: string): string {
  const section = FORUM_SECTIONS.find((s) => s.id === sectionId);
  return section?.title ?? sectionId;
}

function rowToThreadSummary(row: RawThreadRow): ForumThreadSummary {
  return {
    id: Number(row.id),
    sectionId: row.section_id,
    sectionTitle: resolveSectionTitle(row.section_id),
    title: row.title,
    userId: Number(row.user_id),
    userScreenName: resolveScreenName(row.screen_name, row.email, Number(row.user_id)),
    userAvatarUrl: row.avatar_url,
    postCount: Number(row.post_count),
    viewCount: Number(row.view_count),
    video1Id: row.video1_id ?? null,
    video2Id: row.video2_id ?? null,
    latestPostAt: row.latest_post_at,
    isPinned: Boolean(row.is_pinned),
    isLocked: Boolean(row.is_locked),
    createdAt: row.created_at,
  };
}

function rowToPostDetail(row: RawPostRow): ForumPostDetail {
  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    userId: Number(row.user_id),
    userScreenName: resolveScreenName(row.screen_name, row.email, Number(row.user_id)),
    userAvatarUrl: row.avatar_url,
    content: row.content,
    createdAt: row.created_at,
  };
}

// ── Seed data ───────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-12T00:00:00Z");

/** Generates a stable set of seed threads + posts across forum sections. */
function buildSeedThreads(): ForumThreadSummary[] {
  const threadDefs: Array<{
    sectionId: string;
    title: string;
    userId: number;
    userScreenName: string;
    userAvatarUrl: string | null;
    postCount: number;
    viewCount: number;
    video1Id: string | null;
    video2Id: string | null;
    isPinned: boolean;
    isLocked: boolean;
    createdAt: Date;
  }> = [
    {
      sectionId: "new-finds",
      title: "Just found Blackbraid — why is nobody talking about them?",
      userId: 1,
      userScreenName: "metalhead42",
      userAvatarUrl: null,
      postCount: 5,
      viewCount: 142,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-12T06:30:00Z"),
    },
    {
      sectionId: "new-finds",
      title: "Discovered an incredible Japanese metal band — Ningen Isu",
      userId: 2,
      userScreenName: "riffraider",
      userAvatarUrl: null,
      postCount: 3,
      viewCount: 89,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-11T22:15:00Z"),
    },
    {
      sectionId: "new-finds",
      title: "This Mongolian folk-metal band (The Hu) is absolutely unreal",
      userId: 3,
      userScreenName: "skullcrusher99",
      userAvatarUrl: null,
      postCount: 7,
      viewCount: 203,
      video1Id: null,
      video2Id: null,
      isPinned: true,
      isLocked: false,
      createdAt: new Date("2026-06-10T14:00:00Z"),
    },
    {
      sectionId: "track-battles",
      title: "Metallica - Master of Puppets vs Megadeth - Holy Wars",
      userId: 4,
      userScreenName: "thrashking",
      userAvatarUrl: null,
      postCount: 12,
      viewCount: 315,
      video1Id: "E0ozmU9cJDg",
      video2Id: "9d4ui9q7Agw",
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-12T04:45:00Z"),
    },
    {
      sectionId: "track-battles",
      title: "Death - Crystal Mountain vs Opeth - Blackwater Park",
      userId: 5,
      userScreenName: "progdeathfan",
      userAvatarUrl: null,
      postCount: 8,
      viewCount: 178,
      video1Id: "dH7pN2KdBw4",
      video2Id: "8qHxN3jFw5b",
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-11T16:20:00Z"),
    },
    {
      sectionId: "deep-cuts",
      title: "Testament's The Legacy album — every track is a hidden gem",
      userId: 6,
      userScreenName: "oldschoolthrash",
      userAvatarUrl: null,
      postCount: 4,
      viewCount: 67,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-11T09:00:00Z"),
    },
    {
      sectionId: "deep-cuts",
      title: "Coroner's entire discography belongs here — start with No More Color",
      userId: 2,
      userScreenName: "riffraider",
      userAvatarUrl: null,
      postCount: 6,
      viewCount: 94,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-10T20:30:00Z"),
    },
    {
      sectionId: "live-legends",
      title: "Gojira at Red Rocks — best live sound I've ever heard",
      userId: 7,
      userScreenName: "concertjunkie",
      userAvatarUrl: null,
      postCount: 9,
      viewCount: 231,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-12T08:10:00Z"),
    },
    {
      sectionId: "live-legends",
      title: "Pantera's 1991 Moscow show — the raw energy is unmatched",
      userId: 8,
      userScreenName: "groovemaster",
      userAvatarUrl: null,
      postCount: 3,
      viewCount: 156,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-09T12:45:00Z"),
    },
    {
      sectionId: "riff-lab",
      title: "How does Chuck Schuldiner get that tone on Symbolic?",
      userId: 5,
      userScreenName: "progdeathfan",
      userAvatarUrl: null,
      postCount: 11,
      viewCount: 287,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-11T18:00:00Z"),
    },
    {
      sectionId: "riff-lab",
      title: "Drop C vs D Standard for modern metal — what are you using?",
      userId: 9,
      userScreenName: "guitargeek",
      userAvatarUrl: null,
      postCount: 15,
      viewCount: 342,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-10T10:15:00Z"),
    },
    {
      sectionId: "requests-recommendations",
      title: "Looking for bands like early Opeth with the same atmosphere",
      userId: 10,
      userScreenName: "mellotronfan",
      userAvatarUrl: null,
      postCount: 6,
      viewCount: 112,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-12T02:30:00Z"),
    },
    {
      sectionId: "requests-recommendations",
      title: "Need doom metal with clean vocals — tired of growls",
      userId: 11,
      userScreenName: "doomseeker",
      userAvatarUrl: null,
      postCount: 8,
      viewCount: 198,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-11T14:50:00Z"),
    },
    {
      sectionId: "site-support",
      title: "Playback keeps pausing on Firefox — anyone else?",
      userId: 1,
      userScreenName: "metalhead42",
      userAvatarUrl: null,
      postCount: 3,
      viewCount: 55,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-12T07:00:00Z"),
    },
    {
      sectionId: "site-support",
      title: "Feature request: dark mode toggle independent of OS setting",
      userId: 12,
      userScreenName: "nightowl",
      userAvatarUrl: null,
      postCount: 2,
      viewCount: 41,
      video1Id: null,
      video2Id: null,
      isPinned: false,
      isLocked: false,
      createdAt: new Date("2026-06-11T20:00:00Z"),
    },
  ];

  return threadDefs.map((def, idx) => ({
    id: idx + 1,
    ...def,
    sectionTitle: resolveSectionTitle(def.sectionId),
    latestPostAt: new Date(def.createdAt.getTime() + def.postCount * 3600000),
    isLocked: def.isLocked,
  }));
}

const SEED_THREADS: ForumThreadSummary[] = buildSeedThreads();

const SEED_POSTS: ForumPostDetail[] = [
  { id: 1, threadId: 1, userId: 1, userScreenName: "metalhead42", userAvatarUrl: null, content: "I stumbled across Blackbraid on Bandcamp last night and I'm genuinely shocked they aren't bigger. The blend of black metal with indigenous American themes is something I've never heard before. The riffs on 'Barefoot Ghost Dance' are incredible — melodic without losing any of the rawness. Anyone else discovered them recently?", createdAt: new Date("2026-06-12T06:30:00Z") },
  { id: 2, threadId: 1, userId: 3, userScreenName: "skullcrusher99", userAvatarUrl: null, content: "Blackbraid is absolutely legit. Check out their first album if you haven't — the atmosphere is heavier and more raw. The production on the newer material is cleaner but the songwriting on the debut is stronger.", createdAt: new Date("2026-06-12T07:15:00Z") },
  { id: 3, threadId: 1, userId: 6, userScreenName: "oldschoolthrash", userAvatarUrl: null, content: "They're actually getting quite a lot of attention in the underground scene. Played Roadburn last year and killed it. The indigenous themes are not a gimmick — the guy who runs the project is genuinely connected to that culture and it shows in the music.", createdAt: new Date("2026-06-12T08:00:00Z") },
  { id: 4, threadId: 1, userId: 1, userScreenName: "metalhead42", userAvatarUrl: null, content: "That's awesome to hear about Roadburn. I'll definitely dig into the debut. There's something about one-person black metal projects that often produces really focused, coherent work.", createdAt: new Date("2026-06-12T08:45:00Z") },
  { id: 5, threadId: 1, userId: 7, userScreenName: "concertjunkie", userAvatarUrl: null, content: "I saw them at that Roadburn set and it was one of the highlights of the festival. They had a full live band and the energy was massive. Way heavier live than on record.", createdAt: new Date("2026-06-12T09:30:00Z") },

  { id: 6, threadId: 3, userId: 3, userScreenName: "skullcrusher99", userAvatarUrl: null, content: "The Hu are from Mongolia and they play what they call 'hunnu rock' — traditional Mongolian throat singing and instruments combined with heavy metal. Their version of 'Wolf Totem' has over 100 million views on YouTube for good reason. The morin khuur (horsehead fiddle) sounds massive through distortion.", createdAt: new Date("2026-06-10T14:00:00Z") },
  { id: 7, threadId: 3, userId: 8, userScreenName: "groovemaster", userAvatarUrl: null, content: "Mongolian throat singing over metal riffs is one of those combinations that shouldn't work but absolutely does. The rhythmic patterns of traditional Mongolian music actually fit metal drumming really naturally.", createdAt: new Date("2026-06-10T14:45:00Z") },

  { id: 8, threadId: 10, userId: 5, userScreenName: "progdeathfan", userAvatarUrl: null, content: "I've been trying to nail Chuck's tone on Symbolic for months. The key seems to be the Marshall Valvestate 8100 — not a tube amp, which surprises a lot of people. He used a Boss DS-1 as a boost into the clean channel from what I can gather. The mids are scooped but not in the usual death metal way — there's still a lot of definition.", createdAt: new Date("2026-06-11T18:00:00Z") },
  { id: 9, threadId: 10, userId: 9, userScreenName: "guitargeek", userAvatarUrl: null, content: "The Valvestate is key but so is the tuning. He was in D standard on Symbolic and the string gauge matters for that tight, percussive attack. Also worth noting that the bass (Kelly Conlon on that record) is doing a lot of the heavy lifting in the low end — the guitar tone is fairly thin in isolation but sits perfectly in the mix.", createdAt: new Date("2026-06-11T18:30:00Z") },
  { id: 10, threadId: 10, userId: 2, userScreenName: "riffraider", userAvatarUrl: null, content: "Don't overlook the production by Jim Morris at Morrisound. The way the guitars are layered on that record is masterful. Chuck would double-track rhythm parts and the slight variations in timing create that swarming, organic quality.", createdAt: new Date("2026-06-11T19:15:00Z") },

  { id: 11, threadId: 12, userId: 10, userScreenName: "mellotronfan", userAvatarUrl: null, content: "Morningrise and MAYH-era Opeth had this incredible atmosphere that I've been chasing for years. The combination of acoustic passages, twin guitar harmonies, and the way the growls are used more as texture than as a constant — it's a very specific vibe. Agalloch gets close, especially on The Mantle. Any other suggestions?", createdAt: new Date("2026-06-12T02:30:00Z") },
  { id: 12, threadId: 12, userId: 5, userScreenName: "progdeathfan", userAvatarUrl: null, content: "Try early Katatonia — Brave Murder Day has Mikael Åkerfeldt on vocals and has that same melancholy atmosphere. Also, October Tide's Rain Without End is basically early Opeth worship in the best way.", createdAt: new Date("2026-06-12T03:00:00Z") },
  { id: 13, threadId: 12, userId: 11, userScreenName: "doomseeker", userAvatarUrl: null, content: "Seconding Agalloch and Katatonia. You might also want to check out Fen from the UK — their album The Malediction Fields has that mix of post-rock atmosphere with black metal. And for something more obscure, Aquilus from Australia blends classical composition with extreme metal in a way that Opeth fans usually appreciate.", createdAt: new Date("2026-06-12T03:45:00Z") },
];

// ── DB queries ──────────────────────────────────────────────────────────────

const LATEST_THREADS_QUERY = `
  SELECT
    t.id,
    t.section_id,
    t.title,
    t.user_id,
    u.screen_name,
    u.email,
    u.avatar_url,
    t.is_pinned,
    t.is_locked,
    t.view_count,
    t.video1_id,
    t.video2_id,
    t.created_at,
    t.updated_at,
    COALESCE(pc.cnt, 0) AS post_count,
    lp.latest_post_at
  FROM forum_threads t
  LEFT JOIN users u ON u.id = t.user_id
  LEFT JOIN (
    SELECT thread_id, MAX(created_at) AS latest_post_at
    FROM forum_posts
    GROUP BY thread_id
  ) lp ON lp.thread_id = t.id
  LEFT JOIN (
    SELECT thread_id, COUNT(*) AS cnt
    FROM forum_posts
    GROUP BY thread_id
  ) pc ON pc.thread_id = t.id
  ORDER BY t.is_pinned DESC, t.updated_at DESC, t.created_at DESC
  LIMIT ?
`;

const SECTION_THREADS_QUERY = `
  SELECT
    t.id,
    t.section_id,
    t.title,
    t.user_id,
    u.screen_name,
    u.email,
    u.avatar_url,
    t.is_pinned,
    t.is_locked,
    t.view_count,
    t.video1_id,
    t.video2_id,
    t.created_at,
    t.updated_at,
    COALESCE(pc.cnt, 0) AS post_count,
    lp.latest_post_at
  FROM forum_threads t
  LEFT JOIN users u ON u.id = t.user_id
  LEFT JOIN (
    SELECT thread_id, MAX(created_at) AS latest_post_at
    FROM forum_posts
    GROUP BY thread_id
  ) lp ON lp.thread_id = t.id
  LEFT JOIN (
    SELECT thread_id, COUNT(*) AS cnt
    FROM forum_posts
    GROUP BY thread_id
  ) pc ON pc.thread_id = t.id
  WHERE t.section_id = ?
  ORDER BY t.is_pinned DESC, t.updated_at DESC, t.created_at DESC
  LIMIT ?
`;

const SECTION_COUNTS_QUERY = `
  SELECT section_id, COUNT(*) AS thread_count
  FROM forum_threads
  GROUP BY section_id
`;

/**
 * Count unseen threads (created after lastSeen) and threads with new posts
 * (latest post created after lastSeen) per section for a given user.
 * Returns zero for sections the user has never visited.
 */
const SECTION_UNSEEN_COUNTS_QUERY = `
  SELECT
    t.section_id,
    COUNT(DISTINCT CASE
      WHEN t.created_at > COALESCE(ss.last_seen_at, '1970-01-01')
      THEN t.id
    END) AS new_threads,
    COUNT(DISTINCT CASE
      WHEN lp.latest_post_at > COALESCE(ss.last_seen_at, '1970-01-01')
       AND t.created_at <= COALESCE(ss.last_seen_at, '1970-01-01')
      THEN t.id
    END) AS updated_threads
  FROM forum_threads t
  LEFT JOIN forum_section_seen ss ON ss.section_id = t.section_id AND ss.user_id = ?
  LEFT JOIN (SELECT thread_id, MAX(created_at) AS latest_post_at FROM forum_posts GROUP BY thread_id) lp ON lp.thread_id = t.id
  GROUP BY t.section_id
`;

const THREAD_POSTS_QUERY = `
  SELECT
    p.id,
    p.thread_id,
    p.user_id,
    u.screen_name,
    u.email,
    u.avatar_url,
    p.content,
    p.created_at
  FROM forum_posts p
  LEFT JOIN users u ON u.id = p.user_id
  WHERE p.thread_id = ?
  ORDER BY p.created_at ASC
`;

function validateSectionId(sectionId: string): boolean {
  return FORUM_SECTIONS.some((s) => s.id === sectionId);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get latest threads across all sections, newest first (pinned first).
 * Falls back to seed data when DB is unavailable.
 */
export async function getLatestThreads(limit = 20): Promise<ForumThreadSummary[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<RawThreadRow[]>(
      LATEST_THREADS_QUERY,
      limit,
    );
    if (rows.length === 0) return SEED_THREADS.slice(0, limit);
    return rows.map(rowToThreadSummary);
  } catch {
    return SEED_THREADS.slice(0, limit);
  }
}

/**
 * Get threads for a specific section, newest first (pinned first).
 * Falls back to filtered seed data when DB is unavailable.
 */
export async function getSectionThreads(
  sectionId: string,
  limit = 30,
): Promise<ForumThreadSummary[]> {
  if (!validateSectionId(sectionId)) {
    return [];
  }
  try {
    const rows = await prisma.$queryRawUnsafe<RawThreadRow[]>(
      SECTION_THREADS_QUERY,
      sectionId,
      limit,
    );
    if (rows.length === 0) {
      return SEED_THREADS
        .filter((t) => t.sectionId === sectionId)
        .slice(0, limit);
    }
    return rows.map(rowToThreadSummary);
  } catch {
    return SEED_THREADS
      .filter((t) => t.sectionId === sectionId)
      .slice(0, limit);
  }
}

/**
 * Get a single thread with all its posts in chronological order.
 * Falls back to seed data when DB is unavailable.
 */
export async function getThreadDetail(threadId: number): Promise<ForumThreadDetail | null> {
  try {
    // Fetch thread row
    const threadRows = await prisma.$queryRawUnsafe<RawThreadRow[]>(
      `SELECT
        t.id, t.section_id, t.title, t.user_id,
        u.screen_name, u.email, u.avatar_url,
        t.is_pinned, t.is_locked, t.view_count,
        t.video1_id, t.video2_id,
        t.created_at, t.updated_at,
        COALESCE(pc.cnt, 0) AS post_count,
        lp.latest_post_at
      FROM forum_threads t
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN (
        SELECT thread_id, MAX(created_at) AS latest_post_at
        FROM forum_posts GROUP BY thread_id
      ) lp ON lp.thread_id = t.id
      LEFT JOIN (
        SELECT thread_id, COUNT(*) AS cnt
        FROM forum_posts GROUP BY thread_id
      ) pc ON pc.thread_id = t.id
      WHERE t.id = ?`,
      threadId,
    );

    if (threadRows.length === 0) {
      // Fall through to seed data
      throw new Error("Thread not found");
    }

    const thread = rowToThreadSummary(threadRows[0]);

    const postRows = await prisma.$queryRawUnsafe<RawPostRow[]>(
      THREAD_POSTS_QUERY,
      threadId,
    );

    // Fetch vote counts
    const voteCounts = await getVoteCounts(threadId).catch(() => null);

    return {
      thread,
      posts: postRows.map(rowToPostDetail),
      voteCounts,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve video metadata for all [video:XXXXX] tags found in forum post content.
 * Uses the same pipeline as the main player (getStoredVideoById → mapVideo) so
 * the embedded player receives channelTitle resolved as a display artist.
 * Returns a plain Record (serializable across server/client boundary), or null
 * if no videos found or DB unreachable.
 */
export type ResolvedVideoMeta = {
  title: string;
  channelTitle: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  artistVideoCount: number | null;
  genre: string;
};

export async function resolveVideoMetadataMap(
  posts: Array<{ content: string }>,
): Promise<Record<string, ResolvedVideoMeta> | null> {
  const ids = new Set<string>();
  for (const post of posts) {
    for (const m of post.content.matchAll(/\[video:([\w-]{11})\]/g)) {
      ids.add(m[1]);
    }
  }
  if (ids.size === 0) return null;

  // Fetch each video through the same pipeline the main player uses
  // (getStoredVideoById → mapVideo), so channelTitle is a resolved
  // display artist, not a raw YouTube channel title.
  try {
    const results = await Promise.all(
      [...ids].map(async (videoId) => {
        const stored = await getStoredVideoById(videoId, { includeUnapproved: true });
        if (!stored) return null;
        const video = mapVideo(stored);
        return { videoId, video };
      }),
    );

    const record: Record<string, ResolvedVideoMeta> = {};
    for (const result of results) {
      if (!result) continue;
      record[result.videoId] = {
        title: result.video.title,
        channelTitle: result.video.channelTitle,
        parsedArtist: result.video.parsedArtist ?? null,
        parsedTrack: result.video.parsedTrack ?? null,
        artistVideoCount: result.video.artistVideoCount ?? null,
        genre: result.video.genre,
      };
    }

    return Object.keys(record).length > 0 ? record : null;
  } catch {
    return null;
  }
}

/**
 * Create a new thread with its opening post.
 * Returns the created thread summary.
 */
export async function createThread(
  sectionId: string,
  title: string,
  userId: number,
  content: string,
  video1Id?: string | null,
  video2Id?: string | null,
): Promise<ForumThreadSummary | null> {
  if (!validateSectionId(sectionId)) return null;
  if (!title.trim() || !content.trim() || !userId) return null;

  const v1 = video1Id?.trim() || null;
  const v2 = video2Id?.trim() || null;

  try {
    return await prisma.$transaction(async (tx) => {
      // Insert thread (with optional video IDs for track battles)
      const hasVideos = v1 && v2;
      await tx.$executeRawUnsafe(
        hasVideos
          ? `INSERT INTO forum_threads (section_id, title, user_id, video1_id, video2_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3))`
          : `INSERT INTO forum_threads (section_id, title, user_id, created_at, updated_at)
             VALUES (?, ?, ?, NOW(3), NOW(3))`,
        ...(hasVideos ? [sectionId, title.trim(), userId, v1, v2] : [sectionId, title.trim(), userId]),
      );

      // Get the inserted thread ID (reliable within transaction — same connection)
      const idRows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT LAST_INSERT_ID() AS id`,
      );
      const threadId = Number(idRows[0]?.id);
      if (!threadId || threadId <= 0) {
        throw new Error("Failed to retrieve new thread ID");
      }

      // Insert opening post
      await tx.$executeRawUnsafe(
        `INSERT INTO forum_posts (thread_id, user_id, content, created_at, updated_at)
         VALUES (?, ?, ?, NOW(3), NOW(3))`,
        threadId,
        userId,
        content.trim(),
      );

      // Return the created thread summary
      const rows = await tx.$queryRawUnsafe<RawThreadRow[]>(
        `SELECT
          t.id, t.section_id, t.title, t.user_id,
          u.screen_name, u.email, u.avatar_url,
          t.is_pinned, t.is_locked, t.view_count,
          t.video1_id, t.video2_id,
          t.created_at, t.updated_at,
          1 AS post_count,
          t.created_at AS latest_post_at
        FROM forum_threads t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.id = ?`,
        threadId,
      );

      if (rows.length === 0) {
        throw new Error("Failed to fetch created thread summary");
      }
      return rowToThreadSummary(rows[0]);
    });
  } catch {
    return null;
  }
}

/**
 * Add a reply to an existing thread.
 * Returns the created post detail, or null on failure.
 */
export async function createPost(
  threadId: number,
  userId: number,
  content: string,
): Promise<ForumPostDetail | null> {
  if (!content.trim() || !userId || !threadId) return null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO forum_posts (thread_id, user_id, content, created_at, updated_at)
         VALUES (?, ?, ?, NOW(3), NOW(3))`,
        threadId,
        userId,
        content.trim(),
      );

      const idRows = await tx.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT LAST_INSERT_ID() AS id`,
      );
      const postId = Number(idRows[0]?.id);
      if (!postId || postId <= 0) return null;

      const rows = await tx.$queryRawUnsafe<RawPostRow[]>(
        `SELECT
          p.id, p.thread_id, p.user_id,
          u.screen_name, u.email, u.avatar_url,
          p.content, p.created_at
        FROM forum_posts p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.id = ?`,
        postId,
      );

      return rows.length > 0 ? rowToPostDetail(rows[0]) : null;
    });

    return result;
  } catch (err) {
    console.error("[forum-data] createPost failed:", err);
    return null;
  }
}

/**
 * Increment the view count for a thread (fire-and-forget).
 */
export async function incrementThreadViewCount(threadId: number): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE forum_threads SET view_count = view_count + 1 WHERE id = ?`,
      threadId,
    );
  } catch {
    // Best-effort; view counts are not critical.
  }
}

// ── Voting (track battles) ────────────────────────────────────────────────────

type RawVoteCountRow = {
  vote: number;
  cnt: number | bigint;
};

/**
 * Get vote counts for a thread. Returns { votes1, votes2 }.
 */
export async function getVoteCounts(threadId: number): Promise<ThreadVoteCounts | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<RawVoteCountRow[]>(
      `SELECT vote, COUNT(*) AS cnt
       FROM forum_votes
       WHERE thread_id = ?
       GROUP BY vote`,
      threadId,
    );
    let votes1 = 0;
    let votes2 = 0;
    for (const row of rows) {
      if (row.vote === 1) votes1 = Number(row.cnt);
      else if (row.vote === 2) votes2 = Number(row.cnt);
    }
    return { votes1, votes2 };
  } catch {
    return null;
  }
}

type RawUserVoteRow = {
  vote: number;
};

/**
 * Get the current user's vote for a thread (1, 2, or null if not voted).
 */
export async function getUserVote(threadId: number, userId: number): Promise<number | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<RawUserVoteRow[]>(
      `SELECT vote FROM forum_votes WHERE thread_id = ? AND user_id = ?`,
      threadId,
      userId,
    );
    return rows.length > 0 ? rows[0].vote : null;
  } catch {
    return null;
  }
}

/**
 * Cast or change a vote on a track battle thread.
 * vote must be 1 or 2. Uses INSERT ... ON DUPLICATE KEY UPDATE for idempotent upsert.
 */
export async function castVote(
  threadId: number,
  userId: number,
  vote: number,
): Promise<ThreadVoteCounts | null> {
  if (vote !== 1 && vote !== 2) return null;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO forum_votes (thread_id, user_id, vote, created_at)
       VALUES (?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE vote = VALUES(vote)`,
      threadId,
      userId,
      vote,
    );
    return getVoteCounts(threadId);
  } catch {
    return null;
  }
}

// ── Section metadata ─────────────────────────────────────────────────────────

type SectionCountRow = {
  section_id: string;
  thread_count: number | bigint;
};

type SectionUnseenRow = {
  section_id: string;
  new_threads: number | bigint;
  updated_threads: number | bigint;
};

/**
 * Get thread counts for every valid forum section.
 * Falls back to counting seed data when DB is unavailable.
 */
export async function getSectionThreadCounts(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const s of FORUM_SECTIONS) map.set(s.id, 0);

  try {
    const rows = await prisma.$queryRawUnsafe<SectionCountRow[]>(SECTION_COUNTS_QUERY);
    for (const row of rows) {
      map.set(row.section_id, Number(row.thread_count));
    }
    return map;
  } catch {
    // Seed fallback
    for (const t of SEED_THREADS) {
      map.set(t.sectionId, (map.get(t.sectionId) ?? 0) + 1);
    }
    return map;
  }
}

/**
 * Get unseen counts per section for a given user.
 * Returns `{ newThreads, updatedThreads }` per sectionId.
 */
export async function getSectionUnseenCounts(
  userId: number,
): Promise<Map<string, { newThreads: number; updatedThreads: number }>> {
  const map = new Map<string, { newThreads: number; updatedThreads: number }>();
  for (const s of FORUM_SECTIONS) map.set(s.id, { newThreads: 0, updatedThreads: 0 });

  try {
    const rows = await prisma.$queryRawUnsafe<SectionUnseenRow[]>(
      SECTION_UNSEEN_COUNTS_QUERY,
      userId,
    );
    for (const row of rows) {
      map.set(row.section_id, {
        newThreads: Number(row.new_threads),
        updatedThreads: Number(row.updated_threads),
      });
    }
    return map;
  } catch {
    return map;
  }
}

/**
 * Mark a section as seen by the current user (upserts lastSeenAt to NOW).
 */
export async function markSectionSeen(userId: number, sectionId: string): Promise<void> {
  if (!validateSectionId(sectionId)) return;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO forum_section_seen (user_id, section_id, last_seen_at)
       VALUES (?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE last_seen_at = NOW(3)`,
      userId, sectionId,
    );
  } catch { /* best-effort */ }
}

/** The seed threads — used by the left rail and as fallback. */
export { SEED_THREADS };