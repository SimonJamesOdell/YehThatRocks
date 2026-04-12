#!/usr/bin/env bash
set -euo pipefail

# Verifies Prisma migration state and live DB schema parity on VPS.
# Run from the repository root on the VPS.

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[schema-verify] repo not found at $REPO_DIR" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[schema-verify] env file not found at $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[schema-verify] compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

cd "$REPO_DIR"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "[schema-verify] Ensuring services are running"
"${COMPOSE[@]}" ps web db

echo "[schema-verify] Prisma migration status"
"${COMPOSE[@]}" exec -T web npx prisma migrate status --schema /app/prisma/schema.prisma

echo "[schema-verify] Prisma schema diff (DB vs schema.prisma)"
set +e
"${COMPOSE[@]}" exec -T web sh -lc 'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel /app/prisma/schema.prisma --exit-code'
DIFF_EXIT=$?
set -e

if [ "$DIFF_EXIT" -eq 2 ]; then
  echo "[schema-verify] Drift detected: live DB differs from schema.prisma" >&2
  exit 2
fi

if [ "$DIFF_EXIT" -ne 0 ]; then
  echo "[schema-verify] prisma migrate diff failed with exit code $DIFF_EXIT" >&2
  exit "$DIFF_EXIT"
fi

echo "[schema-verify] Checking hidden_videos DDL"
DDL_OUTPUT="$("${COMPOSE[@]}" exec -T db sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -D "$MYSQL_DATABASE" -e "SHOW CREATE TABLE hidden_videos\\G"')"
echo "$DDL_OUTPUT"

for required in \
  "UNIQUE KEY `hidden_videos_user_id_video_id_key` (`user_id`,`video_id`)" \
  "KEY `hidden_videos_user_id_created_at_idx` (`user_id`,`created_at`)" \
  "KEY `hidden_videos_video_id_idx` (`video_id`)"
do
  if ! grep -Fq "$required" <<<"$DDL_OUTPUT"; then
    echo "[schema-verify] Missing expected hidden_videos index: $required" >&2
    exit 3
  fi
done

echo "[schema-verify] Checking watch_history DDL"
WATCH_DDL_OUTPUT="$("${COMPOSE[@]}" exec -T db sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -D "$MYSQL_DATABASE" -e "SHOW CREATE TABLE watch_history\\G"')"
echo "$WATCH_DDL_OUTPUT"

for required in \
  "UNIQUE KEY `watch_history_user_video_unique` (`user_id`,`video_id`)" \
  "KEY `watch_history_user_last_watched_idx` (`user_id`,`last_watched_at`)" \
  "KEY `watch_history_video_idx` (`video_id`)"
do
  if ! grep -Fq "$required" <<<"$WATCH_DDL_OUTPUT"; then
    echo "[schema-verify] Missing expected watch_history index: $required" >&2
    exit 4
  fi
done

echo "[schema-verify] Relevant Prisma migration records"
"${COMPOSE[@]}" exec -T db sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -D "$MYSQL_DATABASE" -e "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name IN (\"20260412_hidden_videos\", \"20260412030719_auto\", \"20260410_watch_history\") ORDER BY migration_name;"'

echo "[schema-verify] OK: Live schema matches schema.prisma and expected table indexes are present"
