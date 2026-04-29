import { prisma } from "@/lib/db";

type ExternalApiUsageInput = {
  provider: "youtube" | "groq";
  endpoint: string;
  units: number;
  success: boolean;
  statusCode?: number | null;
  note?: string | null;
};

const API_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const API_USAGE_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // prune once per hour

let hasEnsuredApiUsageTable = false;
let ensureApiUsageTablePromise: Promise<void> | null = null;
let lastPrunedApiUsageAtMs = 0;

async function ensureApiUsageTable() {
  if (hasEnsuredApiUsageTable) {
    return;
  }

  if (ensureApiUsageTablePromise) {
    return ensureApiUsageTablePromise;
  }

  ensureApiUsageTablePromise = prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS external_api_usage_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(32) NOT NULL,
      endpoint VARCHAR(128) NOT NULL,
      units INT NOT NULL DEFAULT 1,
      success TINYINT(1) NOT NULL DEFAULT 1,
      status_code INT NULL,
      note VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_external_api_usage_provider_created (provider, created_at),
      KEY idx_external_api_usage_created (created_at)
    )
  `)
    .then(() => {
      hasEnsuredApiUsageTable = true;
    })
    .finally(() => {
      ensureApiUsageTablePromise = null;
    });

  return ensureApiUsageTablePromise;
}

export async function recordExternalApiUsage(input: ExternalApiUsageInput) {
  try {
    await ensureApiUsageTable();
    await prisma.$executeRaw`
      INSERT INTO external_api_usage_events (
        provider,
        endpoint,
        units,
        success,
        status_code,
        note,
        created_at
      )
      VALUES (
        ${input.provider},
        ${input.endpoint.slice(0, 128)},
        ${Math.max(1, Math.floor(input.units || 1))},
        ${input.success ? 1 : 0},
        ${input.statusCode ?? null},
        ${input.note?.slice(0, 255) ?? null},
        ${new Date()}
      )
    `;

    // Best-effort rolling 24h pruning — runs at most once per hour.
    const now = Date.now();
    if (now - lastPrunedApiUsageAtMs > API_USAGE_PRUNE_INTERVAL_MS) {
      lastPrunedApiUsageAtMs = now;
      const cutoff = new Date(now - API_USAGE_WINDOW_MS);
      void prisma.$executeRaw`
        DELETE FROM external_api_usage_events
        WHERE created_at < ${cutoff}
      `.catch(() => {
        // Best-effort — never fail a record call due to pruning.
      });
    }
  } catch {
    // Best-effort telemetry only: never block product behavior.
  }
}
