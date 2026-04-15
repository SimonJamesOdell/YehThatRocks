#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
DISABLE_SLOW_LOG_AFTER_EXPORT="${DISABLE_SLOW_LOG_AFTER_EXPORT:-1}"
TOP_N="${TOP_N:-80}"

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
if [ ! -f "$STATE_FILE" ]; then
  echo "[profiling] state file not found at $STATE_FILE" >&2
  echo "[profiling] run: bash deploy/start-db-profiling.sh" >&2
  exit 1
fi

STARTED_AT_UTC="$(grep -E '^STARTED_AT_UTC=' "$STATE_FILE" | head -n 1 | cut -d'=' -f2- || true)"
STARTED_AT_UTC="${STARTED_AT_UTC#\"}"
STARTED_AT_UTC="${STARTED_AT_UTC%\"}"

if [ -z "$STARTED_AT_UTC" ]; then
  echo "[profiling] STARTED_AT_UTC missing in $STATE_FILE" >&2
  exit 1
fi

OUT_DIR="$REPO_DIR/logs"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +"%Y%m%d-%H%M%S")"
OUT_FILE="$OUT_DIR/db-profiling-report-$STAMP.txt"

{
  echo "[profiling] report generated UTC: $(date -u +"%Y-%m-%d %H:%M:%S")"
  echo "[profiling] sample started UTC: $STARTED_AT_UTC"
  echo "[profiling] top rows: $TOP_N"
  echo

  echo "=== MySQL slow query runtime settings ==="
  run_mysql_query "
SHOW VARIABLES WHERE Variable_name IN ('slow_query_log','long_query_time','min_examined_row_limit','log_output');
"

  echo
  echo "=== Top slow query patterns by total time (since start) ==="
  run_mysql_query "
SELECT
  COUNT(*) AS calls,
  ROUND(SUM(TIME_TO_SEC(query_time)), 3) AS total_query_s,
  ROUND(AVG(TIME_TO_SEC(query_time)), 4) AS avg_query_s,
  SUM(rows_examined) AS rows_examined_total,
  SUM(rows_sent) AS rows_sent_total,
  LEFT(REPLACE(REPLACE(sql_text, CHAR(10), ' '), CHAR(13), ' '), 280) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '$STARTED_AT_UTC'
GROUP BY sample_sql
ORDER BY total_query_s DESC
LIMIT $TOP_N;
"

  echo
  echo "=== Top slow query patterns by call count (since start) ==="
  run_mysql_query "
SELECT
  COUNT(*) AS calls,
  ROUND(SUM(TIME_TO_SEC(query_time)), 3) AS total_query_s,
  ROUND(AVG(TIME_TO_SEC(query_time)), 4) AS avg_query_s,
  SUM(rows_examined) AS rows_examined_total,
  LEFT(REPLACE(REPLACE(sql_text, CHAR(10), ' '), CHAR(13), ' '), 280) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '$STARTED_AT_UTC'
GROUP BY sample_sql
ORDER BY calls DESC
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
