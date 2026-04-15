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

STATE_FILE="$REPO_DIR/logs/db-profiling-state.env"
if [ ! -f "$STATE_FILE" ]; then
  echo "[profiling] state file not found at $STATE_FILE" >&2
  echo "[profiling] run: bash deploy/start-db-profiling.sh" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$STATE_FILE"
if [ -z "${STARTED_AT_UTC:-}" ]; then
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
  "${COMPOSE[@]}" exec -T db sh -lc '
mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -Nse "
SHOW VARIABLES WHERE Variable_name IN (\"slow_query_log\",\"long_query_time\",\"min_examined_row_limit\",\"log_output\");
" "$MYSQL_DATABASE"
'

  echo
  echo "=== Top slow query patterns by total time (since start) ==="
  "${COMPOSE[@]}" exec -T db sh -lc '
mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -Nse "
SELECT
  COUNT(*) AS calls,
  ROUND(SUM(TIME_TO_SEC(query_time)), 3) AS total_query_s,
  ROUND(AVG(TIME_TO_SEC(query_time)), 4) AS avg_query_s,
  SUM(rows_examined) AS rows_examined_total,
  SUM(rows_sent) AS rows_sent_total,
  LEFT(REPLACE(REPLACE(sql_text, CHAR(10), '\'' '\''), CHAR(13), '\'' '\''), 280) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '\''$STARTED_AT_UTC'\''
GROUP BY sample_sql
ORDER BY total_query_s DESC
LIMIT '"$TOP_N"';
" "$MYSQL_DATABASE"
'

  echo
  echo "=== Top slow query patterns by call count (since start) ==="
  "${COMPOSE[@]}" exec -T db sh -lc '
mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -Nse "
SELECT
  COUNT(*) AS calls,
  ROUND(SUM(TIME_TO_SEC(query_time)), 3) AS total_query_s,
  ROUND(AVG(TIME_TO_SEC(query_time)), 4) AS avg_query_s,
  SUM(rows_examined) AS rows_examined_total,
  LEFT(REPLACE(REPLACE(sql_text, CHAR(10), '\'' '\''), CHAR(13), '\'' '\''), 280) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '\''$STARTED_AT_UTC'\''
GROUP BY sample_sql
ORDER BY calls DESC
LIMIT '"$TOP_N"';
" "$MYSQL_DATABASE"
'

  echo
  echo "=== Top individual statements by query_time (since start) ==="
  "${COMPOSE[@]}" exec -T db sh -lc '
mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -Nse "
SELECT
  DATE_FORMAT(start_time, '\''%Y-%m-%d %H:%i:%s'\'') AS started,
  ROUND(TIME_TO_SEC(query_time), 4) AS query_s,
  rows_examined,
  rows_sent,
  LEFT(REPLACE(REPLACE(sql_text, CHAR(10), '\'' '\''), CHAR(13), '\'' '\''), 280) AS sample_sql
FROM mysql.slow_log
WHERE start_time >= '\''$STARTED_AT_UTC'\''
ORDER BY query_time DESC
LIMIT '"$TOP_N"';
" "$MYSQL_DATABASE"
'

} | tee "$OUT_FILE"

if [ "$DISABLE_SLOW_LOG_AFTER_EXPORT" = "1" ]; then
  echo "[profiling] disabling slow query log after export"
  "${COMPOSE[@]}" exec -T db sh -lc '
mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -Nse "
SET GLOBAL slow_query_log = OFF;
SHOW VARIABLES WHERE Variable_name = \"slow_query_log\";
" "$MYSQL_DATABASE"
'
fi

echo "[profiling] report saved: $OUT_FILE"
