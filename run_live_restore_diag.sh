#!/usr/bin/env bash
#
# Linux port of run_live_restore_diag.ps1 — downloads the live production
# database and restores it into the local Docker MySQL for local development.
#
# Lessons encoded here (carried over from the Windows original):
#   - Use --skip-triggers on mysqldump (trigger DELIMITER ;; blocks cannot be
#     piped through non-interactive mysql clients).
#   - Use docker cp + file redirect inside the container instead of piping
#     (long INSERT lines get silently truncated through pipes on some hosts).
#   - --single-transaction can silently skip certain InnoDB tables; verify
#     counts afterward (tables, videos, site_videos).

set -euo pipefail

SSH_HOST="${YTR_VPS_HOST:-root@206.189.122.114}"

command -v ssh >/dev/null 2>&1 || { echo "[restore] ssh not found" >&2; exit 1; }
command -v scp >/dev/null 2>&1 || { echo "[restore] scp not found" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "[restore] docker not found" >&2; exit 1; }

echo "[restore] STEP1: dumping live DB on $SSH_HOST ..."
# Dump to a fixed remote path (avoids round-tripping a timestamped filename).
ssh "$SSH_HOST" 'cd /srv/yehthatrocks && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db sh -c "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mysqldump -uroot --single-transaction --no-tablespaces --routines --skip-triggers \"\$MYSQL_DATABASE\"" > /tmp/yeh_live_notrig.sql && wc -c /tmp/yeh_live_notrig.sql >&2'

echo "[restore] STEP2: downloading ..."
mkdir -p backups/live
LOCAL_DUMP="backups/live/yeh_live_notrig_$(date -u +%Y%m%d-%H%M%S).sql"
scp "$SSH_HOST:/tmp/yeh_live_notrig.sql" "$LOCAL_DUMP"
echo "[restore]        bytes: $(stat -c %s "$LOCAL_DUMP")"

# Tidy up the remote dump now that it has been downloaded.
ssh "$SSH_HOST" "rm -f /tmp/yeh_live_notrig.sql" >/dev/null 2>&1 || true

echo "[restore] STEP4: docker compose up -d db"
docker compose up -d db

echo "[restore]        waiting for db to become healthy ..."
healthy=0
for _ in $(seq 1 60); do
  # Use the same connection method the restore steps use (root over the
  # unix socket) so readiness is guaranteed for the actual import, not just
  # the compose TCP healthcheck (which can pass before the socket is ready).
  if docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "SELECT 1"' >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  echo "[restore] ERROR: local db did not become healthy" >&2
  exit 1
fi

DB_CTR="$(docker compose ps -q db | tr -d '\r')"
echo "[restore] STEP5: db container: $DB_CTR"
docker cp "$LOCAL_DUMP" "$DB_CTR:/tmp/live_notrig.sql"

echo "[restore] STEP6: recreating 'yeh' database ..."
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE IF EXISTS yeh; CREATE DATABASE yeh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"'

echo "[restore] STEP6: importing dump ..."
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot yeh < /tmp/live_notrig.sql'

echo "[restore] STEP7: verification counts (tables, videos, site_videos):"
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE(); SELECT COUNT(*) FROM videos; SELECT COUNT(*) FROM site_videos;" yeh'

echo "[restore] DONE. Local DB restored from live at $LOCAL_DUMP"
