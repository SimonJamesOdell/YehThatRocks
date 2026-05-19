import { prisma } from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/catalog-data-utils";
import { normalizeNewVideoGenreFilters } from "@/lib/new-video-genre-filters";

let hasEnsuredNewVideosPreferencesTable = false;
let ensureNewVideosPreferencesTablePromise: Promise<void> | null = null;

async function ensureNewVideosPreferencesTable() {
  if (hasEnsuredNewVideosPreferencesTable) {
    return;
  }

  if (ensureNewVideosPreferencesTablePromise) {
    return ensureNewVideosPreferencesTablePromise;
  }

  ensureNewVideosPreferencesTablePromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_new_videos_preferences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      genre_filters TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_new_videos_preferences_user (user_id),
      KEY idx_user_new_videos_preferences_user (user_id)
    )
  `)
    .then(() => {
      hasEnsuredNewVideosPreferencesTable = true;
    })
    .finally(() => {
      ensureNewVideosPreferencesTablePromise = null;
    });

  return ensureNewVideosPreferencesTablePromise;
}

export async function getNewVideosGenrePreferenceForUser(input: { userId: number }) {
  if (!hasDatabaseUrl()) {
    return [] as string[];
  }

  await ensureNewVideosPreferencesTable();

  const rows = await prisma.$queryRaw<Array<{ genre_filters: string | null }>>`
    SELECT genre_filters
    FROM user_new_videos_preferences
    WHERE user_id = ${input.userId}
    LIMIT 1
  `;

  const raw = rows[0]?.genre_filters;
  if (!raw) {
    return [] as string[];
  }

  try {
    return normalizeNewVideoGenreFilters(JSON.parse(raw));
  } catch {
    return [] as string[];
  }
}

export async function setNewVideosGenrePreferenceForUser(input: { userId: number; genres: string[] }) {
  if (!hasDatabaseUrl()) {
    return { ok: false as const };
  }

  await ensureNewVideosPreferencesTable();

  const genres = normalizeNewVideoGenreFilters(input.genres);

  await prisma.$executeRaw`
    INSERT INTO user_new_videos_preferences (
      user_id,
      genre_filters
    )
    VALUES (
      ${input.userId},
      ${JSON.stringify(genres)}
    )
    ON DUPLICATE KEY UPDATE
      genre_filters = VALUES(genre_filters),
      updated_at = CURRENT_TIMESTAMP
  `;

  return { ok: true as const };
}
