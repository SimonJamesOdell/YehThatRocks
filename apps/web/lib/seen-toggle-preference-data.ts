import { prisma } from "@/lib/db";

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

let hasEnsuredSeenTogglePreferencesTable = false;
let ensureSeenTogglePreferencesTablePromise: Promise<void> | null = null;

async function ensureSeenTogglePreferencesTable() {
  if (hasEnsuredSeenTogglePreferencesTable) {
    return;
  }

  if (ensureSeenTogglePreferencesTablePromise) {
    return ensureSeenTogglePreferencesTablePromise;
  }

  ensureSeenTogglePreferencesTablePromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_seen_toggle_preferences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      preference_key VARCHAR(160) NOT NULL,
      preference_value TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_seen_toggle_preferences_user_key (user_id, preference_key),
      KEY idx_user_seen_toggle_preferences_user (user_id)
    )
  `)
    .then(() => {
      hasEnsuredSeenTogglePreferencesTable = true;
    })
    .finally(() => {
      ensureSeenTogglePreferencesTablePromise = null;
    });

  return ensureSeenTogglePreferencesTablePromise;
}

export async function getSeenTogglePreferenceForUser(input: {
  userId: number;
  key: string;
}) {
  if (!hasDatabaseUrl()) {
    return null;
  }

  await ensureSeenTogglePreferencesTable();

  const rows = await prisma.$queryRaw<Array<{ preference_value: number | bigint }>>`
    SELECT preference_value
    FROM user_seen_toggle_preferences
    WHERE user_id = ${input.userId}
      AND preference_key = ${input.key}
    LIMIT 1
  `;

  const value = rows[0]?.preference_value;
  if (value === undefined) {
    return null;
  }

  const numeric = Number(typeof value === "bigint" ? value : Number(value));
  return numeric > 0;
}

export async function setSeenTogglePreferenceForUser(input: {
  userId: number;
  key: string;
  value: boolean;
}) {
  if (!hasDatabaseUrl()) {
    return { ok: false as const };
  }

  await ensureSeenTogglePreferencesTable();

  await prisma.$executeRaw`
    INSERT INTO user_seen_toggle_preferences (
      user_id,
      preference_key,
      preference_value
    )
    VALUES (
      ${input.userId},
      ${input.key},
      ${input.value ? 1 : 0}
    )
    ON DUPLICATE KEY UPDATE
      preference_value = VALUES(preference_value),
      updated_at = CURRENT_TIMESTAMP
  `;

  return { ok: true as const };
}
