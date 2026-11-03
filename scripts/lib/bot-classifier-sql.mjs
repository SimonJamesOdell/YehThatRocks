/**
 * Shared SQL for the behavioural bot classifier.
 *
 * A distributed botnet (residential proxies + headless browsers) has been
 * inflating "unique visitors" by firing a handful of analytics events per
 * visitor and per IP, using spoofed-but-plausible browser User-Agents. The
 * reliable signal is behavioural, so this module builds the UPDATE that sets
 * `analytics_events.is_suspected_bot` from four signatures:
 *
 *   (1) one-shot    — anonymous, low-activity visitor on an IP that itself
 *                     produced only a handful of events inside a short burst
 *                     (the original classifier).
 *   (2) proxy-pool  — one IP shared by >=3 distinct anonymous visitors, none of
 *                     which produces more than a few events (residential-proxy
 *                     rotation signature observed since 2026-10-26).
 *   (3) video-only  — anonymous visitor firing video_view events with zero
 *                     page_view events (a catalog walker hitting the API
 *                     directly; real viewers always load a page first).
 *   (4) headerless  — events with no resolvable IP and no User-Agent (a
 *                     direct-to-origin / stripped-header flood; see the
 *                     2026-10-25 spike).
 *
 * The maintenance job recomputes the flag over a rolling window every run, so
 * a real visitor whose IP later accumulates authenticated or higher-volume
 * activity graduates back out of the suspected set. Downstream rollups and
 * series exclude `is_suspected_bot = 1` rows.
 */

// Rolling classification window. Only recent rows are (re)classified; older
// rows keep their existing flag. Keeping this bounded avoids a full-table
// GROUP BY + UPDATE every maintenance tick.
export const BOT_CLASSIFY_WINDOW_DAYS = 7;

// (1) one-shot
export const BOT_ONE_SHOT_MAX_EVENTS = 5;
export const BOT_ONE_SHOT_MAX_SPAN_MINUTES = 60;

// (2) proxy-pool
export const BOT_PROXY_IP_MIN_VISITORS = 3;
export const BOT_PROXY_IP_MAX_EVENTS_PER_VISITOR = 5;

// (3) video-only walker
export const BOT_VIDEO_ONLY_MIN_VIDEO_VIEWS = 3;

function toWindowDays(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid bot classification window: ${String(value)}`);
  }
  return n;
}

/**
 * Build the `UPDATE analytics_events …` statement that recomputes
 * `is_suspected_bot` for every row inside the rolling window. `windowDays`
 * must be a positive integer; the SQL interpolates only this validated number.
 */
export function buildBotClassificationSql(windowDays) {
  const window = toWindowDays(windowDays);

  return `
    UPDATE analytics_events e
    LEFT JOIN (
      SELECT visitor_id FROM (
        -- (1) one-shot
        SELECT v.visitor_id
        FROM (
          SELECT
            visitor_id,
            MAX(ip_hash) AS ip_hash,
            COUNT(*) AS ev_count,
            SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS authed_count
          FROM analytics_events
          WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${window} DAY)
          GROUP BY visitor_id
        ) v
        JOIN (
          SELECT ip_hash
          FROM analytics_events
          WHERE ip_hash IS NOT NULL
            AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${window} DAY)
          GROUP BY ip_hash
          HAVING COUNT(*) <= ${BOT_ONE_SHOT_MAX_EVENTS}
             AND TIMESTAMPDIFF(MINUTE, MIN(created_at), MAX(created_at)) <= ${BOT_ONE_SHOT_MAX_SPAN_MINUTES}
        ) one_shot ON one_shot.ip_hash = v.ip_hash
        WHERE v.ev_count <= ${BOT_ONE_SHOT_MAX_EVENTS}
          AND v.authed_count = 0

        UNION

        -- (2) proxy-pool
        SELECT pv.visitor_id
        FROM (
          SELECT
            ip_hash,
            visitor_id,
            COUNT(*) AS ev_count,
            SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS authed_count
          FROM analytics_events
          WHERE ip_hash IS NOT NULL
            AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${window} DAY)
          GROUP BY ip_hash, visitor_id
        ) pv
        JOIN (
          SELECT ip_hash
          FROM (
            SELECT
              ip_hash,
              visitor_id,
              COUNT(*) AS ev_count,
              SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS authed_count
            FROM analytics_events
            WHERE ip_hash IS NOT NULL
              AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${window} DAY)
            GROUP BY ip_hash, visitor_id
          ) pv_agg
          GROUP BY ip_hash
          HAVING COUNT(*) >= ${BOT_PROXY_IP_MIN_VISITORS}
             AND SUM(authed_count) = 0
             AND MAX(ev_count) <= ${BOT_PROXY_IP_MAX_EVENTS_PER_VISITOR}
        ) proxy_ips ON proxy_ips.ip_hash = pv.ip_hash
        WHERE pv.authed_count = 0

        UNION

        -- (3) video-only walker
        SELECT visitor_id
        FROM analytics_events
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${window} DAY)
        GROUP BY visitor_id
        HAVING SUM(CASE WHEN event_type = 'video_view' THEN 1 ELSE 0 END) >= ${BOT_VIDEO_ONLY_MIN_VIDEO_VIEWS}
           AND SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) = 0
           AND SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) = 0

        UNION

        -- (4) headerless
        SELECT visitor_id
        FROM analytics_events
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${window} DAY)
          AND ip_hash IS NULL
          AND user_agent IS NULL
        GROUP BY visitor_id
      ) bot_visitors
    ) bots ON bots.visitor_id = e.visitor_id
    SET e.is_suspected_bot = (bots.visitor_id IS NOT NULL)
    WHERE e.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${window} DAY)
  `;
}
