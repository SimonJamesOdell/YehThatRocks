#!/usr/bin/env bash
#
# Linux live-DB restore — downloads the live production database and restores
# it into the local native MySQL (systemd `mysql.service`, port 3306) for local
# development. The local dev DB no longer uses Docker.
#
# Lessons encoded here (carried over from the Windows/Docker original):
#   - Use --skip-triggers on mysqldump (trigger DELIMITER ;; blocks cannot be
#     piped through non-interactive mysql clients).
#   - --single-transaction can silently skip certain InnoDB tables; verify
#     counts afterward (tables, videos, site_videos).
#   - Requires passwordless sudo for the `mysql` client (see
#     /etc/sudoers.d/codewhale-mysql) because native MySQL `root` uses
#     auth_socket.

set -euo pipefail

SSH_HOST="${YTR_VPS_HOST:-root@206.189.122.114}"
LOCAL_MYSQL="sudo -n mysql"

command -v ssh >/dev/null 2>&1 || { echo "[restore] ssh not found" >&2; exit 1; }
command -v scp >/dev/null 2>&1 || { echo "[restore] scp not found" >&2; exit 1; }
command -v mysql >/dev/null 2>&1 || { echo "[restore] mysql client not found" >&2; exit 1; }

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

echo "[restore] STEP3: checking local native MySQL is reachable ..."
if ! $LOCAL_MYSQL -e "SELECT 1" >/dev/null 2>&1; then
  echo "[restore] ERROR: local MySQL (3306) is not reachable. Is mysql.service running?" >&2
  exit 1
fi

echo "[restore] STEP4: recreating 'yeh' database ..."
$LOCAL_MYSQL -e "DROP DATABASE IF EXISTS yeh; CREATE DATABASE yeh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "[restore] STEP5: importing dump ..."
$LOCAL_MYSQL yeh < "$LOCAL_DUMP"

echo "[restore] STEP6: verification counts (tables, videos, site_videos):"
$LOCAL_MYSQL -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'yeh'; SELECT COUNT(*) FROM yeh.videos; SELECT COUNT(*) FROM yeh.site_videos;"

echo "[restore] DONE. Local DB restored from live at $LOCAL_DUMP"
