#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
LONG_QUERY_TIME="${LONG_QUERY_TIME:-0.20}"
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
