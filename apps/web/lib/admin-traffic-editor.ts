import { prisma } from "@/lib/db";
import type {
  TrafficAdjustmentGranularity,
  TrafficAdjustmentSeries,
} from "@/components/admin-dashboard-types";

/**
 * Direct traffic-data editing.
 *
 * The overview traffic graph is derived from raw `analytics_events` (plus
 * `auth_audit_logs` and `magazine_article_external_landings` for two count
 * series). To "clean up" a false traffic spike the admin drags a graph handle
 * to a target value; this module deterministically flags/unflags the underlying
 * rows as `manually_excluded` so the metric reaches that value, and every
 * downstream rollup/series query (maintenance script + in-process rollups)
 * filters those rows out. No separate edits table is used — the source traffic
 * data itself is edited, and the change survives every recompute.
 */

type SqlDateTime = string;

// Client series key -> bucket JSON field (shared with the cache patch).
const SERIES_FIELD: Record<TrafficAdjustmentSeries, string> = {
  pageViews: "pageViews",
  videoViews: "videoViews",
  visitors: "uniqueVisitors",
  newVisitors: "newVisitors",
  returnVisits: "returnVisits",
  sessions: "sessions",
  magazineExternalLandings: "magazineExternalLandings",
  authEvents: "authEvents",
};

function toSqlUtcDateTime(iso: string): SqlDateTime {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid bucket time");
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function toSafeLimit(value: number): number {
  const limit = Math.trunc(value);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("Invalid adjustment count");
  }
  return limit;
}

function toUtcDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid bucket time");
  }
  return date.toISOString().slice(0, 10);
}

function eventBaseWhere(start: SqlDateTime, end: SqlDateTime, currentlyExcluded: 0 | 1): string {
  return `created_at >= '${start}' AND created_at < '${end}' AND is_suspected_bot = 0 AND manually_excluded = ${currentlyExcluded}`;
}

/**
 * Compute each visitor's true first-ever visit day, but only for visitors who
 * have a page-view event inside the bucket being edited. The previous version
 * grouped MIN(DATE(created_at)) over the entire analytics_events table on every
 * edit, which is a full-table scan + GROUP BY even for a single-day bucket.
 * Scoping the candidate set to active visitors keeps the result identical while
 * letting MySQL drive the lookup through the (visitorId) index.
 */
function buildFirstDaySubquerySql(start: SqlDateTime, end: SqlDateTime, currentlyExcluded: 0 | 1): string {
  return `
    SELECT visitor_id, MIN(DATE(created_at)) AS first_day
    FROM analytics_events
    WHERE visitor_id IN (
      SELECT DISTINCT visitor_id
      FROM analytics_events
      WHERE ${eventBaseWhere(start, end, currentlyExcluded)} AND event_type = 'page_view'
    )
    GROUP BY visitor_id
  `;
}

function firstDayPredicate(
  granularity: TrafficAdjustmentGranularity,
  kind: "new" | "return",
  bucketStartIso: string,
): string {
  if (granularity === "daily") {
    const day = toUtcDay(bucketStartIso);
    return kind === "new" ? `fs.first_day = '${day}'` : `fs.first_day < '${day}'`;
  }

  if (granularity === "weekly" || granularity === "monthly") {
    const day = toUtcDay(bucketStartIso);
    return kind === "new" ? `fs.first_day >= '${day}'` : `fs.first_day < '${day}'`;
  }

  const year = new Date(bucketStartIso).getUTCFullYear();
  return kind === "new" ? `YEAR(fs.first_day) = ${year}` : `YEAR(fs.first_day) < ${year}`;
}

async function hasMagazineLandingsTable(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(`
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'magazine_article_external_landings'
  `).catch(() => []);

  return Number(rows[0]?.count ?? 0) > 0;
}

async function ensureMagazineLandingsManualExclusionColumn(): Promise<void> {
  if (!(await hasMagazineLandingsTable())) {
    return;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(`
    SELECT COUNT(*) AS count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'magazine_article_external_landings'
      AND column_name = 'manually_excluded'
  `).catch(() => []);

  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE magazine_article_external_landings
    ADD COLUMN manually_excluded BOOLEAN NOT NULL DEFAULT false
  `).catch(() => {
    // Best-effort: if the table is mid-migration this will be retried next edit.
  });
}

type CountRow = { c: bigint | number };

async function queryCount(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<CountRow[]>(sql).catch(() => []);
  const numeric = Number(rows[0]?.c ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function readEventSeriesCurrentValue(
  series: TrafficAdjustmentSeries,
  granularity: TrafficAdjustmentGranularity,
  start: SqlDateTime,
  end: SqlDateTime,
  bucketStartIso: string,
): Promise<number> {
  const base = `created_at >= '${start}' AND created_at < '${end}' AND is_suspected_bot = 0 AND manually_excluded = 0`;

  switch (series) {
    case "pageViews":
      return queryCount(`SELECT COUNT(*) AS c FROM analytics_events WHERE ${base} AND event_type = 'page_view'`);
    case "videoViews":
      return queryCount(`SELECT COUNT(*) AS c FROM analytics_events WHERE ${base} AND event_type = 'video_view'`);
    case "visitors":
      return queryCount(`SELECT COUNT(DISTINCT visitor_id) AS c FROM analytics_events WHERE ${base} AND event_type = 'page_view'`);
    case "sessions":
      if (granularity === "hourly") return 0;
      return queryCount(`SELECT COUNT(DISTINCT session_id) AS c FROM analytics_events WHERE ${base} AND event_type = 'page_view'`);
    case "newVisitors":
      if (granularity === "hourly") return 0;
      return queryCount(`
        SELECT COUNT(DISTINCT ev.visitor_id) AS c
        FROM (
          SELECT ae.visitor_id, fs.first_day
          FROM analytics_events ae
          INNER JOIN (
            ${buildFirstDaySubquerySql(start, end, 0)}
          ) fs ON fs.visitor_id = ae.visitor_id
          WHERE ${base} AND ae.event_type = 'page_view'
        ) ev
        WHERE ${firstDayPredicate(granularity, "new", bucketStartIso)}
      `);
    case "returnVisits":
      if (granularity === "hourly") {
        return queryCount(`
          SELECT COUNT(DISTINCT visitor_id) AS c
          FROM analytics_events
          WHERE ${base} AND event_type = 'page_view' AND is_new_visitor = 0
        `);
      }
      return queryCount(`
        SELECT COUNT(DISTINCT ev.visitor_id) AS c
        FROM (
          SELECT ae.visitor_id, fs.first_day
          FROM analytics_events ae
          INNER JOIN (
            ${buildFirstDaySubquerySql(start, end, 0)}
          ) fs ON fs.visitor_id = ae.visitor_id
          WHERE ${base} AND ae.event_type = 'page_view'
        ) ev
        WHERE ${firstDayPredicate(granularity, "return", bucketStartIso)}
      `);
    case "authEvents":
      return queryCount(`
        SELECT COUNT(*) AS c
        FROM auth_audit_logs
        WHERE created_at >= '${start}' AND created_at < '${end}'
          AND success = 1 AND action IN ('login', 'register')
          AND manually_excluded = 0
      `);
    case "magazineExternalLandings":
      if (granularity === "hourly") return 0;
      if (!(await hasMagazineLandingsTable())) return 0;
      await ensureMagazineLandingsManualExclusionColumn();
      return queryCount(`
        SELECT COUNT(*) AS c
        FROM magazine_article_external_landings
        WHERE landed_at >= '${start}' AND landed_at < '${end}'
          AND manually_excluded = 0
      `);
    default:
      return 0;
  }
}

function buildEventCountEditSql(
  eventType: string,
  start: SqlDateTime,
  end: SqlDateTime,
  limit: number,
  setExcluded: boolean,
): string {
  const currentlyExcluded: 0 | 1 = setExcluded ? 0 : 1;
  return `
    UPDATE analytics_events
    SET manually_excluded = ${setExcluded ? 1 : 0}
    WHERE id IN (
      SELECT id FROM (
        SELECT id
        FROM analytics_events
        WHERE ${eventBaseWhere(start, end, currentlyExcluded)} AND event_type = '${eventType}'
        ORDER BY id DESC
        LIMIT ${limit}
      ) t
    )
  `;
}

function buildEventDistinctEditSql(
  entity: "visitor_id" | "session_id",
  start: SqlDateTime,
  end: SqlDateTime,
  limit: number,
  setExcluded: boolean,
  extraWhere = "",
): string {
  const currentlyExcluded: 0 | 1 = setExcluded ? 0 : 1;
  return `
    UPDATE analytics_events
    SET manually_excluded = ${setExcluded ? 1 : 0}
    WHERE id IN (
      SELECT id FROM (
        SELECT ae.id
        FROM analytics_events ae
        INNER JOIN (
          SELECT ${entity}
          FROM analytics_events
          WHERE ${eventBaseWhere(start, end, currentlyExcluded)} AND event_type = 'page_view' ${extraWhere}
          GROUP BY ${entity}
          ORDER BY MAX(id) DESC
          LIMIT ${limit}
        ) v ON v.${entity} = ae.${entity}
        WHERE ${eventBaseWhere(start, end, currentlyExcluded)} AND ae.event_type = 'page_view'
      ) t
    )
  `;
}

function buildEventFirstDayEditSql(
  start: SqlDateTime,
  end: SqlDateTime,
  limit: number,
  setExcluded: boolean,
  firstDayClause: string,
): string {
  const currentlyExcluded: 0 | 1 = setExcluded ? 0 : 1;
  return `
    UPDATE analytics_events
    SET manually_excluded = ${setExcluded ? 1 : 0}
    WHERE id IN (
      SELECT id FROM (
        SELECT ae.id
        FROM analytics_events ae
        INNER JOIN (
          SELECT aev.visitor_id
          FROM analytics_events aev
          INNER JOIN (
            ${buildFirstDaySubquerySql(start, end, currentlyExcluded)}
          ) fs ON fs.visitor_id = aev.visitor_id
          WHERE ${eventBaseWhere(start, end, currentlyExcluded)} AND aev.event_type = 'page_view' AND ${firstDayClause}
          GROUP BY aev.visitor_id, fs.first_day
          ORDER BY MAX(aev.id) DESC
          LIMIT ${limit}
        ) v ON v.visitor_id = ae.visitor_id
        WHERE ${eventBaseWhere(start, end, currentlyExcluded)} AND ae.event_type = 'page_view'
      ) t
    )
  `;
}

function buildRowCountEditSql(
  table: string,
  dateColumn: string,
  start: SqlDateTime,
  end: SqlDateTime,
  limit: number,
  setExcluded: boolean,
  extraWhere = "",
): string {
  const currentlyExcluded: 0 | 1 = setExcluded ? 0 : 1;
  return `
    UPDATE ${table}
    SET manually_excluded = ${setExcluded ? 1 : 0}
    WHERE id IN (
      SELECT id FROM (
        SELECT id
        FROM ${table}
        WHERE ${dateColumn} >= '${start}' AND ${dateColumn} < '${end}'
          AND manually_excluded = ${currentlyExcluded}
          ${extraWhere}
        ORDER BY id DESC
        LIMIT ${limit}
      ) t
    )
  `;
}

async function applyEventSeriesEdit(
  series: TrafficAdjustmentSeries,
  granularity: TrafficAdjustmentGranularity,
  start: SqlDateTime,
  end: SqlDateTime,
  bucketStartIso: string,
  limit: number,
  setExcluded: boolean,
): Promise<void> {
  switch (series) {
    case "pageViews":
      await prisma.$executeRawUnsafe(buildEventCountEditSql("page_view", start, end, limit, setExcluded));
      return;
    case "videoViews":
      await prisma.$executeRawUnsafe(buildEventCountEditSql("video_view", start, end, limit, setExcluded));
      return;
    case "visitors":
      await prisma.$executeRawUnsafe(buildEventDistinctEditSql("visitor_id", start, end, limit, setExcluded));
      return;
    case "sessions":
      if (granularity === "hourly") return;
      await prisma.$executeRawUnsafe(buildEventDistinctEditSql("session_id", start, end, limit, setExcluded));
      return;
    case "newVisitors":
      if (granularity === "hourly") return;
      await prisma.$executeRawUnsafe(
        buildEventFirstDayEditSql(start, end, limit, setExcluded, firstDayPredicate(granularity, "new", bucketStartIso)),
      );
      return;
    case "returnVisits":
      if (granularity === "hourly") {
        await prisma.$executeRawUnsafe(
          buildEventDistinctEditSql("visitor_id", start, end, limit, setExcluded, "AND is_new_visitor = 0"),
        );
        return;
      }
      await prisma.$executeRawUnsafe(
        buildEventFirstDayEditSql(start, end, limit, setExcluded, firstDayPredicate(granularity, "return", bucketStartIso)),
      );
      return;
    case "authEvents":
      await prisma.$executeRawUnsafe(
        buildRowCountEditSql("auth_audit_logs", "created_at", start, end, limit, setExcluded, "AND success = 1 AND action IN ('login', 'register')"),
      );
      return;
    case "magazineExternalLandings":
      if (granularity === "hourly") return;
      await ensureMagazineLandingsManualExclusionColumn();
      if (!(await hasMagazineLandingsTable())) return;
      await prisma.$executeRawUnsafe(
        buildRowCountEditSql("magazine_article_external_landings", "landed_at", start, end, limit, setExcluded),
      );
      return;
    default:
      return;
  }
}

export async function applyTrafficEdit(input: {
  granularity: TrafficAdjustmentGranularity;
  series: TrafficAdjustmentSeries;
  bucketStart: string;
  bucketEnd: string;
  targetValue: number;
}): Promise<{ ok: boolean; value: number }> {
  const start = toSqlUtcDateTime(input.bucketStart);
  const end = toSqlUtcDateTime(input.bucketEnd);
  const target = Math.max(0, Math.floor(input.targetValue));

  const current = await readEventSeriesCurrentValue(
    input.series,
    input.granularity,
    start,
    end,
    input.bucketStart,
  );

  if (target === current) {
    return { ok: true, value: target };
  }

  if (target < current) {
    await applyEventSeriesEdit(input.series, input.granularity, start, end, input.bucketStart, toSafeLimit(current - target), true);
  } else {
    await applyEventSeriesEdit(input.series, input.granularity, start, end, input.bucketStart, toSafeLimit(target - current), false);
  }

  const value = await readEventSeriesCurrentValue(input.series, input.granularity, start, end, input.bucketStart);
  return { ok: true, value };
}

/**
 * Patch the pre-computed dashboard cache in place for the edited bucket so the
 * graph reflects the change immediately (before the next scheduled maintenance
 * rebuild). The durable edit is the `manually_excluded` flag on the source
 * rows; this patch only updates the cached view.
 */
export async function patchCachedTrafficValue(input: {
  granularity: TrafficAdjustmentGranularity;
  bucketStart: string;
  series: TrafficAdjustmentSeries;
  value: number;
}): Promise<void> {
  const field = SERIES_FIELD[input.series];
  if (!field) return;

  const rows = await prisma.$queryRaw<Array<{ payload: string }>>`
    SELECT payload FROM admin_dashboard_cache WHERE id = 1
  `.catch(() => []);

  if (rows.length === 0) {
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rows[0].payload) as Record<string, unknown>;
  } catch {
    return;
  }

  const analytics = payload.analytics as
    | { series?: Record<string, unknown>; hourlyRecent?: Array<Record<string, unknown>> }
    | undefined;

  if (!analytics) {
    return;
  }

  if (input.granularity === "hourly") {
    const bucket = (analytics.hourlyRecent ?? []).find((item) => item?.bucketStart === input.bucketStart);
    if (bucket) {
      bucket[field] = input.value;
    }
  } else {
    const series = analytics.series?.[input.granularity];
    if (Array.isArray(series)) {
      const bucket = series.find(
        (item) => item && typeof item === "object" && (item as Record<string, unknown>).bucketStart === input.bucketStart,
      );
      if (bucket && typeof bucket === "object") {
        (bucket as Record<string, unknown>)[field] = input.value;
      }
    }
  }

  await prisma.$executeRaw`
    UPDATE admin_dashboard_cache
    SET payload = ${JSON.stringify(payload)}
    WHERE id = 1
  `;
}
