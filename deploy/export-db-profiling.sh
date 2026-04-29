#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
DISABLE_SLOW_LOG_AFTER_EXPORT="${DISABLE_SLOW_LOG_AFTER_EXPORT:-1}"
AUTO_ENABLE_SLOW_LOG_ON_EXPORT="${AUTO_ENABLE_SLOW_LOG_ON_EXPORT:-1}"
ALLOW_EMPTY_SLOW_LOG_EXPORT="${ALLOW_EMPTY_SLOW_LOG_EXPORT:-0}"
TOP_N="${TOP_N:-80}"
OUTLIER_MIN_TOTAL_S="${OUTLIER_MIN_TOTAL_S:-8}"
OUTLIER_MIN_AVG_S="${OUTLIER_MIN_AVG_S:-0.8}"
OUTLIER_MIN_ROWS_EXAMINED="${OUTLIER_MIN_ROWS_EXAMINED:-1000000}"
OUTLIER_MIN_CALLS="${OUTLIER_MIN_CALLS:-3}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[profiling] env file not found at $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[profiling] compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

cd "$REPO_DIR"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

run_mysql_query() {
  local sql="$1"
  "${COMPOSE[@]}" exec -T db sh -lc '
sql="$1"
if mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -Nse "$sql" "$MYSQL_DATABASE" >/tmp/ytr_mysql_out 2>/tmp/ytr_mysql_err; then
  cat /tmp/ytr_mysql_out
  exit 0
fi

if [ -n "${MYSQL_ROOT_PASSWORD:-}" ] && mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -Nse "$sql" "$MYSQL_DATABASE" >/tmp/ytr_mysql_out 2>/tmp/ytr_mysql_err; then
  cat /tmp/ytr_mysql_out
  exit 0
fi

cat /tmp/ytr_mysql_err >&2
echo "[profiling] MySQL query failed for app user and root fallback." >&2
echo "[profiling] Ensure MYSQL_ROOT_PASSWORD is set for the db container, or grant SYSTEM_VARIABLES_ADMIN / SELECT on mysql.slow_log to MYSQL_USER." >&2
exit 1
' sh "$sql"
}

STATE_FILE="$REPO_DIR/logs/db-profiling-state.env"
STARTED_AT_UTC=""
STATE_LONG_QUERY_TIME=""
STATE_LOG_OUTPUT=""
STATE_MIN_EXAMINED_ROW_LIMIT=""

if [ -f "$STATE_FILE" ]; then
  STARTED_AT_UTC="$(grep -E '^STARTED_AT_UTC=' "$STATE_FILE" | head -n 1 | cut -d'=' -f2- || true)"
  STARTED_AT_UTC="${STARTED_AT_UTC#\"}"
  STARTED_AT_UTC="${STARTED_AT_UTC%\"}"

  STATE_LONG_QUERY_TIME="$(grep -E '^LONG_QUERY_TIME=' "$STATE_FILE" | head -n 1 | cut -d'=' -f2- || true)"
  STATE_LONG_QUERY_TIME="${STATE_LONG_QUERY_TIME#\"}"
  STATE_LONG_QUERY_TIME="${STATE_LONG_QUERY_TIME%\"}"

  STATE_LOG_OUTPUT="$(grep -E '^LOG_OUTPUT=' "$STATE_FILE" | head -n 1 | cut -d'=' -f2- || true)"
  STATE_LOG_OUTPUT="${STATE_LOG_OUTPUT#\"}"
  STATE_LOG_OUTPUT="${STATE_LOG_OUTPUT%\"}"

  STATE_MIN_EXAMINED_ROW_LIMIT="$(grep -E '^MIN_EXAMINED_ROW_LIMIT=' "$STATE_FILE" | head -n 1 | cut -d'=' -f2- || true)"
  STATE_MIN_EXAMINED_ROW_LIMIT="${STATE_MIN_EXAMINED_ROW_LIMIT#\"}"
  STATE_MIN_EXAMINED_ROW_LIMIT="${STATE_MIN_EXAMINED_ROW_LIMIT%\"}"
fi

DB_STARTED_AT_UTC="$(run_mysql_query "
SELECT COALESCE(
  (
    SELECT DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s')
    FROM performance_capture_windows
    WHERE window_key = 'hotspot-analysis'
    ORDER BY started_at DESC
    LIMIT 1
  ),
  ''
)
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'performance_capture_windows'
LIMIT 1;
" 2>/dev/null | tr -d '\r' | tail -n 1 || true)"

if [ -n "$DB_STARTED_AT_UTC" ] && { [ -z "$STARTED_AT_UTC" ] || [[ "$DB_STARTED_AT_UTC" > "$STARTED_AT_UTC" ]]; }; then
  STARTED_AT_UTC="$DB_STARTED_AT_UTC"
fi

if [ -z "$STARTED_AT_UTC" ]; then
  echo "[profiling] no capture start time found in $STATE_FILE or performance_capture_windows" >&2
  echo "[profiling] run: bash deploy/start-db-profiling.sh or use the admin dashboard fresh capture button" >&2
  exit 1
fi

SLOW_QUERY_LOG_STATUS="$(run_mysql_query "
SELECT variable_value
FROM performance_schema.global_variables
WHERE variable_name = 'slow_query_log'
LIMIT 1;
" | tr -d '\r' | tail -n 1 || true)"

if [ "${SLOW_QUERY_LOG_STATUS^^}" != "ON" ]; then
  echo "[profiling] warning: slow_query_log is OFF; slow-log exports from this capture window will be empty." >&2

  if [ "$AUTO_ENABLE_SLOW_LOG_ON_EXPORT" = "1" ]; then
    ARMED_AT_UTC="$(date -u +"%Y-%m-%d %H:%M:%S")"
    APPLY_LONG_QUERY_TIME="${STATE_LONG_QUERY_TIME:-0.10}"
    APPLY_LOG_OUTPUT="${STATE_LOG_OUTPUT:-TABLE}"
    APPLY_MIN_EXAMINED_ROW_LIMIT="${STATE_MIN_EXAMINED_ROW_LIMIT:-0}"

    echo "[profiling] auto-enabling slow query log now and arming a fresh capture window." >&2
    run_mysql_query "
SET GLOBAL log_output = '$APPLY_LOG_OUTPUT';
SET GLOBAL long_query_time = $APPLY_LONG_QUERY_TIME;
SET GLOBAL min_examined_row_limit = $APPLY_MIN_EXAMINED_ROW_LIMIT;
SET GLOBAL slow_query_log = ON;
SHOW VARIABLES WHERE Variable_name IN ('slow_query_log','long_query_time','min_examined_row_limit','log_output');
"

    cat > "$STATE_FILE" <<EOF
STARTED_AT_UTC="$ARMED_AT_UTC"
LONG_QUERY_TIME="$APPLY_LONG_QUERY_TIME"
LOG_OUTPUT="$APPLY_LOG_OUTPUT"
MIN_EXAMINED_ROW_LIMIT="$APPLY_MIN_EXAMINED_ROW_LIMIT"
EOF

    echo "[profiling] slow query logging armed at UTC: $ARMED_AT_UTC" >&2
    echo "[profiling] rerun export after a representative traffic window (for example 10-30 minutes)." >&2
    exit 2
  fi

  echo "[profiling] aborting export. Set AUTO_ENABLE_SLOW_LOG_ON_EXPORT=1 to auto-arm capture." >&2
  exit 2
fi

SLOW_LOG_ROW_COUNT="$(run_mysql_query "
SELECT COUNT(*)
FROM mysql.slow_log
WHERE start_time >= '$STARTED_AT_UTC';
" | tr -d '\r' | tail -n 1 || true)"

if ! [[ "$SLOW_LOG_ROW_COUNT" =~ ^[0-9]+$ ]]; then
  echo "[profiling] failed to read slow log row count for the capture window." >&2
  exit 1
fi

if [ "$SLOW_LOG_ROW_COUNT" -eq 0 ] && [ "$ALLOW_EMPTY_SLOW_LOG_EXPORT" != "1" ]; then
  echo "[profiling] no rows found in mysql.slow_log since capture start ($STARTED_AT_UTC)." >&2
  echo "[profiling] aborting to avoid a non-actionable blank export." >&2
  echo "[profiling] if this is expected, rerun with ALLOW_EMPTY_SLOW_LOG_EXPORT=1." >&2
  exit 3
fi

OUT_DIR="$REPO_DIR/logs"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +"%Y%m%d-%H%M%S")"
OUT_FILE="$OUT_DIR/db-profiling-report-$STAMP.txt"

{
  echo "[profiling] report generated UTC: $(date -u +"%Y-%m-%d %H:%M:%S")"
  echo "[profiling] sample started UTC: $STARTED_AT_UTC"
  echo "[profiling] slow_log_rows_since_start: $SLOW_LOG_ROW_COUNT"
  echo "[profiling] top rows: $TOP_N"
  echo "[profiling] outlier thresholds: total_query_s>=$OUTLIER_MIN_TOTAL_S, avg_query_s>=$OUTLIER_MIN_AVG_S, rows_examined_total>=$OUTLIER_MIN_ROWS_EXAMINED, calls>=$OUTLIER_MIN_CALLS"
  echo

  echo "=== MySQL slow query runtime settings ==="
  run_mysql_query "
SHOW VARIABLES WHERE Variable_name IN ('slow_query_log','long_query_time','min_examined_row_limit','log_output');
"

  echo
  echo "=== Top slow query patterns by total time (since start) ==="
  run_mysql_query "
DROP TEMPORARY TABLE IF EXISTS ytr_slow_agg;

CREATE TEMPORARY TABLE ytr_slow_agg AS
SELECT
  COUNT(*) AS calls,
  ROUND(SUM(TIME_TO_SEC(query_time)), 3) AS total_query_s,
  ROUND(AVG(TIME_TO_SEC(query_time)), 4) AS avg_query_s,
  SUM(rows_examined) AS rows_examined_total,
  SUM(rows_sent) AS rows_sent_total,
  MIN(LEFT(REPLACE(REPLACE(sql_text, CHAR(10), ' '), CHAR(13), ' '), 280)) AS sample_sql_example,
  LEFT(
    REGEXP_REPLACE(
      REPLACE(REPLACE(sql_text, CHAR(10), ' '), CHAR(13), ' '),
      '''[^'']*''|[0-9]+',
      '?'
    ),
    280
  ) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '$STARTED_AT_UTC'
  AND sql_text NOT LIKE '%FROM mysql.slow_log%'
GROUP BY sample_sql;

SELECT
  calls,
  total_query_s,
  avg_query_s,
  rows_examined_total,
  rows_sent_total,
  sample_sql_example,
  sample_sql
FROM ytr_slow_agg
ORDER BY total_query_s DESC
LIMIT $TOP_N;

SELECT '=== Priority outliers first (high confidence) ===';

SELECT
  calls,
  total_query_s,
  avg_query_s,
  rows_examined_total,
  rows_sent_total,
  ROUND(
    (total_query_s * 2.0)
    + (avg_query_s * 25.0)
    + (LEAST(rows_examined_total, 2000000000) / 2000000.0)
    + (calls * 0.15),
    3
  ) AS priority_score,
  sample_sql_example,
  sample_sql
FROM ytr_slow_agg
WHERE calls >= $OUTLIER_MIN_CALLS
  AND (
    total_query_s >= $OUTLIER_MIN_TOTAL_S
    OR avg_query_s >= $OUTLIER_MIN_AVG_S
    OR rows_examined_total >= $OUTLIER_MIN_ROWS_EXAMINED
  )
ORDER BY priority_score DESC, total_query_s DESC, rows_examined_total DESC
LIMIT $TOP_N;

SELECT '=== Top slow query patterns by call count (since start) ===';

SELECT
  calls,
  total_query_s,
  avg_query_s,
  rows_examined_total,
  sample_sql_example,
  sample_sql
FROM ytr_slow_agg
ORDER BY calls DESC
LIMIT $TOP_N;

DROP TEMPORARY TABLE ytr_slow_agg;
"

  echo
  echo "=== Priority outliers by single-statement tail latency ==="
  run_mysql_query "
SELECT
  DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS started,
  ROUND(TIME_TO_SEC(query_time), 4) AS query_s,
  rows_examined,
  rows_sent,
  LEFT(REPLACE(REPLACE(sql_text, CHAR(10), ' '), CHAR(13), ' '), 280) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '$STARTED_AT_UTC'
  AND (
    TIME_TO_SEC(query_time) >= $OUTLIER_MIN_AVG_S
    OR rows_examined >= $OUTLIER_MIN_ROWS_EXAMINED
  )
ORDER BY query_time DESC, rows_examined DESC
LIMIT $TOP_N;
"

  echo
  echo "=== Top individual statements by query_time (since start) ==="
  run_mysql_query "
SELECT
  DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS started,
  ROUND(TIME_TO_SEC(query_time), 4) AS query_s,
  rows_examined,
  rows_sent,
  LEFT(REPLACE(REPLACE(sql_text, CHAR(10), ' '), CHAR(13), ' '), 280) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '$STARTED_AT_UTC'
ORDER BY query_time DESC
LIMIT $TOP_N;
"

} | tee "$OUT_FILE"

if [ "$DISABLE_SLOW_LOG_AFTER_EXPORT" = "1" ]; then
  echo "[profiling] disabling slow query log after export"
  run_mysql_query "
SET GLOBAL slow_query_log = OFF;
SHOW VARIABLES WHERE Variable_name = 'slow_query_log';
"
fi

echo "[profiling] report saved: $OUT_FILE"
