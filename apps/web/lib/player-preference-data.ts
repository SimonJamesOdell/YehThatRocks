import { prisma } from "@/lib/db";

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

let hasEnsuredPlayerPreferencesTable = false;
let ensurePlayerPreferencesTablePromise: Promise<void> | null = null;

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
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_player_preferences_user (user_id),
      KEY idx_user_player_preferences_user (user_id)
    )
  `)
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
    } as const;
  }

  await ensurePlayerPreferencesTable();

  const rows = await prisma.$queryRaw<Array<{
    autoplay_enabled: number | bigint | null;
    volume: number | bigint | null;
  }>>`
    SELECT autoplay_enabled, volume
    FROM user_player_preferences
    WHERE user_id = ${input.userId}
    LIMIT 1
  `;

  const row = rows[0];

  if (!row) {
    return {
      autoplayEnabled: null,
      volume: null,
    } as const;
  }

  const autoplayEnabled = row.autoplay_enabled === null
    ? null
    : Number(row.autoplay_enabled) > 0;

  const volume = row.volume === null
    ? null
    : Math.max(0, Math.min(100, Number(row.volume)));

  return {
    autoplayEnabled,
    volume: Number.isFinite(volume) ? volume : null,
  } as const;
}

export async function setPlayerPreferencesForUser(input: {
  userId: number;
  autoplayEnabled?: boolean;
  volume?: number;
}) {
  if (!hasDatabaseUrl()) {
    return { ok: false as const };
  }

  await ensurePlayerPreferencesTable();

  const autoplayValue = input.autoplayEnabled === undefined ? null : input.autoplayEnabled ? 1 : 0;
  const volumeValue = input.volume === undefined ? null : Math.max(0, Math.min(100, Math.round(input.volume)));

  await prisma.$executeRaw`
    INSERT INTO user_player_preferences (
      user_id,
      autoplay_enabled,
      volume
    )
    VALUES (
      ${input.userId},
      ${autoplayValue},
      ${volumeValue}
    )
    ON DUPLICATE KEY UPDATE
      autoplay_enabled = COALESCE(VALUES(autoplay_enabled), autoplay_enabled),
      volume = COALESCE(VALUES(volume), volume),
      updated_at = CURRENT_TIMESTAMP
  `;

  return { ok: true as const };
}
