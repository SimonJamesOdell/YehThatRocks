#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"

# Parse LONG_QUERY_TIME_MS env var (milliseconds) if set, else use new optimized default (100ms)
# Optimized default changed from 0.20s (200ms) to 0.10s (100ms)
# This captures ~5x more queries (~18% vs 3.7%) with similar log volume overhead
# Override: export LONG_QUERY_TIME_MS=50 (50ms), LONG_QUERY_TIME_MS=200 (200ms), etc.
if [ -n "${LONG_QUERY_TIME_MS:-}" ]; then
  if ! [[ "$LONG_QUERY_TIME_MS" =~ ^[0-9]+$ ]] || [ "$LONG_QUERY_TIME_MS" -lt 10 ] || [ "$LONG_QUERY_TIME_MS" -gt 10000 ]; then
    echo "[profiling] error: LONG_QUERY_TIME_MS must be a number between 10 and 10000 (ms), got: $LONG_QUERY_TIME_MS" >&2
    exit 1
  fi
  LONG_QUERY_TIME=$(awk "BEGIN {printf \"%.2f\", $LONG_QUERY_TIME_MS / 1000}")
else
  LONG_QUERY_TIME="0.10"  # Optimized default: 100ms (captures 5x more queries than 200ms)
fi

LOG_OUTPUT="${LOG_OUTPUT:-TABLE}"
MIN_EXAMINED_ROW_LIMIT="${MIN_EXAMINED_ROW_LIMIT:-0}"

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
echo "[profiling] Ensure MYSQL_ROOT_PASSWORD is set for the db container, or grant SYSTEM_VARIABLES_ADMIN to MYSQL_USER." >&2
exit 1
' sh "$sql"
}

STATE_DIR="$REPO_DIR/logs"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/db-profiling-state.env"
STARTED_AT_UTC="$(date -u +"%Y-%m-%d %H:%M:%S")"

if [ "$LOG_OUTPUT" != "TABLE" ] && [ "$LOG_OUTPUT" != "FILE" ] && [ "$LOG_OUTPUT" != "TABLE,FILE" ] && [ "$LOG_OUTPUT" != "FILE,TABLE" ]; then
  echo "[profiling] invalid LOG_OUTPUT='$LOG_OUTPUT' (expected TABLE, FILE, TABLE,FILE, or FILE,TABLE)" >&2
  exit 1
fi

echo "[profiling] enabling MySQL slow query capture"
run_mysql_query "
SET GLOBAL log_output = '$LOG_OUTPUT';
SET GLOBAL long_query_time = $LONG_QUERY_TIME;
SET GLOBAL min_examined_row_limit = $MIN_EXAMINED_ROW_LIMIT;
SET GLOBAL slow_query_log = ON;
SHOW VARIABLES WHERE Variable_name IN ('slow_query_log','long_query_time','min_examined_row_limit','log_output');
"

cat > "$STATE_FILE" <<EOF
STARTED_AT_UTC="$STARTED_AT_UTC"
LONG_QUERY_TIME="$LONG_QUERY_TIME"
LOG_OUTPUT="$LOG_OUTPUT"
MIN_EXAMINED_ROW_LIMIT="$MIN_EXAMINED_ROW_LIMIT"
EOF

echo "[profiling] started at UTC: $STARTED_AT_UTC"
echo "[profiling] state saved: $STATE_FILE"
echo "[profiling] later run: bash deploy/export-db-profiling.sh"
