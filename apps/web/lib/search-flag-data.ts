import { prisma } from "@/lib/db";
import {
  SEARCH_FLAG_MIN_USERS_FOR_ACTION,
  type SearchFlagReason,
  normalizeSearchFlagCorrection,
  normalizeSearchFlagQuery,
} from "@/lib/search-flags";

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

type SearchFlagAggregateRow = {
  video_id: string;
  reason: SearchFlagReason;
  normalized_correction: string | null;
  user_count: bigint | number;
  admin_count: bigint | number;
};

export async function ensureSearchResultFlagsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS search_result_flags (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      video_id VARCHAR(32) NOT NULL,
      normalized_query VARCHAR(255) NOT NULL,
      reason VARCHAR(64) NOT NULL,
      correction VARCHAR(255) NULL,
      normalized_correction VARCHAR(255) NULL,
      admin_flagger TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_search_result_flags_user_video_query_reason (user_id, video_id, normalized_query, reason),
      KEY idx_search_result_flags_query_video (normalized_query, video_id),
      KEY idx_search_result_flags_query_reason (normalized_query, reason, video_id),
      KEY idx_search_result_flags_admin_query (admin_flagger, normalized_query, video_id)
    )
  `);
}

type RecordSearchFlagInput = {
  userId: number;
  videoId: string;
  query: string;
  reason: SearchFlagReason;
  correction?: string | null;
  adminFlagger: boolean;
};

export async function recordSearchFlag(input: RecordSearchFlagInput) {
  if (!hasDatabaseUrl()) {
    return { ok: false as const, normalizedQuery: "", normalizedCorrection: null as string | null };
  }

  const normalizedQuery = normalizeSearchFlagQuery(input.query);
  const normalizedCorrection = normalizeSearchFlagCorrection(input.correction);

  if (!normalizedQuery) {
    return { ok: false as const, normalizedQuery, normalizedCorrection };
  }

  await ensureSearchResultFlagsTable();
  await prisma.$executeRaw`
    INSERT INTO search_result_flags (
      user_id,
      video_id,
      normalized_query,
      reason,
      correction,
      normalized_correction,
      admin_flagger
    )
    VALUES (
      ${input.userId},
      ${input.videoId},
      ${normalizedQuery},
      ${input.reason},
      ${input.correction?.trim() || null},
      ${normalizedCorrection},
      ${input.adminFlagger ? 1 : 0}
    )
    ON DUPLICATE KEY UPDATE
      correction = VALUES(correction),
      normalized_correction = VALUES(normalized_correction),
      admin_flagger = GREATEST(admin_flagger, VALUES(admin_flagger)),
      created_at = CURRENT_TIMESTAMP
  `;

  return { ok: true as const, normalizedQuery, normalizedCorrection };
}

export async function getSearchFlagConsensus(input: {
  videoId: string;
  query: string;
  reason: SearchFlagReason;
  correction?: string | null;
}) {
  if (!hasDatabaseUrl()) {
    return { matchingUsers: 0, applied: false };
  }

  const normalizedQuery = normalizeSearchFlagQuery(input.query);
  const normalizedCorrection = normalizeSearchFlagCorrection(input.correction);

  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(DISTINCT user_id) AS count
    FROM search_result_flags
    WHERE video_id = ${input.videoId}
      AND normalized_query = ${normalizedQuery}
      AND reason = ${input.reason}
      AND (
        ${input.reason} = 'not-relevant'
        OR (
          normalized_correction IS NOT NULL
          AND normalized_correction = ${normalizedCorrection}
        )
      )
  `;

  const countValue = rows[0]?.count;
  const matchingUsers = Number(typeof countValue === "bigint" ? countValue : Number(countValue ?? 0));
  return {
    matchingUsers,
    applied: matchingUsers >= SEARCH_FLAG_MIN_USERS_FOR_ACTION,
  };
}

export async function getSuppressedSearchVideoIds(input: { userId?: number | null; query: string }) {
  if (!hasDatabaseUrl()) {
    return new Set<string>();
  }

  const normalizedQuery = normalizeSearchFlagQuery(input.query);
  if (!normalizedQuery) {
    return new Set<string>();
  }

  await ensureSearchResultFlagsTable();

  const userRowsPromise = input.userId
    ? prisma.$queryRaw<Array<{ video_id: string }>>`
        SELECT DISTINCT video_id
        FROM search_result_flags
        WHERE user_id = ${input.userId}
          AND normalized_query = ${normalizedQuery}
      `
    : Promise.resolve([] as Array<{ video_id: string }>);

  // "not relevant" should suppress per query. Admin flags act immediately for everyone.
  // Community suppression requires matching reason/correction consensus on the same query.
  const consensusRowsPromise = prisma.$queryRaw<Array<{ video_id: string }>>`
    SELECT DISTINCT flags.video_id
    FROM search_result_flags flags
    WHERE flags.normalized_query = ${normalizedQuery}
      AND (
        flags.admin_flagger = 1
        OR EXISTS (
          SELECT 1
          FROM search_result_flags grouped
          WHERE grouped.video_id = flags.video_id
            AND grouped.normalized_query = flags.normalized_query
            AND grouped.reason = flags.reason
            AND (
              flags.reason = 'not-relevant'
              OR (
                grouped.normalized_correction IS NOT NULL
                AND grouped.normalized_correction = flags.normalized_correction
              )
            )
          GROUP BY grouped.video_id, grouped.normalized_query, grouped.reason, COALESCE(grouped.normalized_correction, '')
          HAVING COUNT(DISTINCT grouped.user_id) >= ${SEARCH_FLAG_MIN_USERS_FOR_ACTION}
        )
      )
  `;

  const [userRows, consensusRows] = await Promise.all([userRowsPromise, consensusRowsPromise]);
  return new Set([...userRows, ...consensusRows].map((row) => row.video_id));
}

export async function getSearchRankingSignals(input: { query: string; candidateVideoIds: string[] }) {
  if (!hasDatabaseUrl()) {
    return {
      suppressedVideoIds: new Set<string>(),
      penaltyByVideoId: new Map<string, number>(),
    };
  }

  const normalizedQuery = normalizeSearchFlagQuery(input.query);
  const candidateVideoIds = Array.from(new Set(input.candidateVideoIds.filter(Boolean)));

  if (!normalizedQuery || candidateVideoIds.length === 0) {
    return {
      suppressedVideoIds: new Set<string>(),
      penaltyByVideoId: new Map<string, number>(),
    };
  }

  await ensureSearchResultFlagsTable();

  const placeholders = candidateVideoIds.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe<Array<SearchFlagAggregateRow>>(
    `
      SELECT
        video_id,
        reason,
        normalized_correction,
        COUNT(DISTINCT user_id) AS user_count,
        SUM(CASE WHEN admin_flagger = 1 THEN 1 ELSE 0 END) AS admin_count
      FROM search_result_flags
      WHERE normalized_query = ?
        AND video_id IN (${placeholders})
      GROUP BY video_id, reason, normalized_correction
    `,
    normalizedQuery,
    ...candidateVideoIds,
  );

  const suppressedVideoIds = new Set<string>();
  const penaltyByVideoId = new Map<string, number>();

  for (const row of rows) {
    const userCount = Number(typeof row.user_count === "bigint" ? row.user_count : Number(row.user_count ?? 0));
    const adminCount = Number(typeof row.admin_count === "bigint" ? row.admin_count : Number(row.admin_count ?? 0));
    const hasAdmin = adminCount > 0;
    const reachedConsensus = userCount >= SEARCH_FLAG_MIN_USERS_FOR_ACTION;

    if (hasAdmin || reachedConsensus) {
      suppressedVideoIds.add(row.video_id);
      continue;
    }

    const currentPenalty = penaltyByVideoId.get(row.video_id) ?? 0;
    const reasonPenalty = row.reason === "not-relevant"
      ? userCount * 30
      : userCount * 18;
    penaltyByVideoId.set(row.video_id, currentPenalty + reasonPenalty);
  }

  return {
    suppressedVideoIds,
    penaltyByVideoId,
  };
}
