import { prisma } from "@/lib/db";
import {
  DEFAULT_AUTOPLAY_MIX,
  normalizeAutoplayGenreFilters,
  normalizeAutoplayMix,
  type AutoplayMixSettings,
} from "@/lib/player-preferences-shared";

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

let hasEnsuredPlayerPreferencesTable = false;
let ensurePlayerPreferencesTablePromise: Promise<void> | null = null;

async function ensurePlayerPreferencesColumnExists(columnName: string, columnDefinitionSql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(`
    SELECT COUNT(*) AS count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'user_player_preferences'
      AND column_name = '${columnName}'
  `);

  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE user_player_preferences
    ADD COLUMN ${columnName} ${columnDefinitionSql}
  `);
}

async function ensurePlayerPreferencesTable() {
  if (hasEnsuredPlayerPreferencesTable) {
    return;
  }

  if (ensurePlayerPreferencesTablePromise) {
    return ensurePlayerPreferencesTablePromise;
  }

  ensurePlayerPreferencesTablePromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_player_preferences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      autoplay_enabled TINYINT(1) NULL,
      volume TINYINT UNSIGNED NULL,
      autoplay_mix_top100 TINYINT UNSIGNED NULL,
      autoplay_mix_favourites TINYINT UNSIGNED NULL,
      autoplay_mix_newest TINYINT UNSIGNED NULL,
      autoplay_mix_random TINYINT UNSIGNED NULL,
      autoplay_genre_filters TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_player_preferences_user (user_id),
      KEY idx_user_player_preferences_user (user_id)
    )
  `)
    .then(async () => {
      await ensurePlayerPreferencesColumnExists("autoplay_mix_top100", "TINYINT UNSIGNED NULL");
      await ensurePlayerPreferencesColumnExists("autoplay_mix_favourites", "TINYINT UNSIGNED NULL");
      await ensurePlayerPreferencesColumnExists("autoplay_mix_newest", "TINYINT UNSIGNED NULL");
      await ensurePlayerPreferencesColumnExists("autoplay_mix_random", "TINYINT UNSIGNED NULL");
      await ensurePlayerPreferencesColumnExists("autoplay_genre_filters", "TEXT NULL");
    })
    .then(() => {
      hasEnsuredPlayerPreferencesTable = true;
    })
    .finally(() => {
      ensurePlayerPreferencesTablePromise = null;
    });

  return ensurePlayerPreferencesTablePromise;
}

export async function getPlayerPreferencesForUser(input: {
  userId: number;
}) {
  if (!hasDatabaseUrl()) {
    return {
      autoplayEnabled: null,
      volume: null,
      autoplayMix: { ...DEFAULT_AUTOPLAY_MIX },
      autoplayGenreFilters: [] as string[],
    } as const;
  }

  await ensurePlayerPreferencesTable();

  const rows = await prisma.$queryRaw<Array<{
    autoplay_enabled: number | bigint | null;
    volume: number | bigint | null;
    autoplay_mix_top100: number | bigint | null;
    autoplay_mix_favourites: number | bigint | null;
    autoplay_mix_newest: number | bigint | null;
    autoplay_mix_random: number | bigint | null;
    autoplay_genre_filters: string | null;
  }>>`
    SELECT
      autoplay_enabled,
      volume,
      autoplay_mix_top100,
      autoplay_mix_favourites,
      autoplay_mix_newest,
      autoplay_mix_random,
      autoplay_genre_filters
    FROM user_player_preferences
    WHERE user_id = ${input.userId}
    LIMIT 1
  `;

  const row = rows[0];

  if (!row) {
    return {
      autoplayEnabled: null,
      volume: null,
      autoplayMix: { ...DEFAULT_AUTOPLAY_MIX },
      autoplayGenreFilters: [] as string[],
    } as const;
  }

  const autoplayEnabled = row.autoplay_enabled === null
    ? null
    : Number(row.autoplay_enabled) > 0;

  const volume = row.volume === null
    ? null
    : Math.max(0, Math.min(100, Number(row.volume)));

  let autoplayGenreFilters: string[] = [];
  if (row.autoplay_genre_filters) {
    try {
      autoplayGenreFilters = normalizeAutoplayGenreFilters(JSON.parse(row.autoplay_genre_filters));
    } catch {
      autoplayGenreFilters = [];
    }
  }

  const autoplayMix = normalizeAutoplayMix({
    top100: row.autoplay_mix_top100,
    favourites: row.autoplay_mix_favourites,
    newest: row.autoplay_mix_newest,
    random: row.autoplay_mix_random,
  });

  return {
    autoplayEnabled,
    volume: Number.isFinite(volume) ? volume : null,
    autoplayMix,
    autoplayGenreFilters,
  } as const;
}

export async function setPlayerPreferencesForUser(input: {
  userId: number;
  autoplayEnabled?: boolean;
  volume?: number;
  autoplayMix?: AutoplayMixSettings;
  autoplayGenreFilters?: string[];
}) {
  if (!hasDatabaseUrl()) {
    return { ok: false as const };
  }

  await ensurePlayerPreferencesTable();

  const autoplayValue = input.autoplayEnabled === undefined ? null : input.autoplayEnabled ? 1 : 0;
  const volumeValue = input.volume === undefined ? null : Math.max(0, Math.min(100, Math.round(input.volume)));
  const autoplayMix = input.autoplayMix ? normalizeAutoplayMix(input.autoplayMix) : null;
  const autoplayGenreFilters = input.autoplayGenreFilters === undefined
    ? undefined
    : normalizeAutoplayGenreFilters(input.autoplayGenreFilters);
  const autoplayGenreFiltersJson = autoplayGenreFilters === undefined
    ? null
    : JSON.stringify(autoplayGenreFilters);

  await prisma.$executeRaw`
    INSERT INTO user_player_preferences (
      user_id,
      autoplay_enabled,
      volume,
      autoplay_mix_top100,
      autoplay_mix_favourites,
      autoplay_mix_newest,
      autoplay_mix_random,
      autoplay_genre_filters
    )
    VALUES (
      ${input.userId},
      ${autoplayValue},
      ${volumeValue},
      ${autoplayMix?.top100 ?? null},
      ${autoplayMix?.favourites ?? null},
      ${autoplayMix?.newest ?? null},
      ${autoplayMix?.random ?? null},
      ${autoplayGenreFiltersJson}
    )
    ON DUPLICATE KEY UPDATE
      autoplay_enabled = COALESCE(VALUES(autoplay_enabled), autoplay_enabled),
      volume = COALESCE(VALUES(volume), volume),
      autoplay_mix_top100 = COALESCE(VALUES(autoplay_mix_top100), autoplay_mix_top100),
      autoplay_mix_favourites = COALESCE(VALUES(autoplay_mix_favourites), autoplay_mix_favourites),
      autoplay_mix_newest = COALESCE(VALUES(autoplay_mix_newest), autoplay_mix_newest),
      autoplay_mix_random = COALESCE(VALUES(autoplay_mix_random), autoplay_mix_random),
      autoplay_genre_filters = COALESCE(VALUES(autoplay_genre_filters), autoplay_genre_filters),
      updated_at = CURRENT_TIMESTAMP
  `;

  return { ok: true as const };
}
