#!/bin/bash
# YTR Live Backup — runs on magazine machine (simon@192.168.0.16)
# Every 3 hours via cron, prunes backups older than 2 days
# Stores on 8TB drive at /media/simon/.../YTR_Backup/

set -euo pipefail

# ── Config ──────────────────────────────────────────────
SSH_HOST="root@yehthatrocks.com"
REMOTE_DIR="/srv/yehthatrocks"
LOCAL_DIR="/media/simon/09469595-d7d3-4ef7-8b39-15e74e0a898f/YTR_Backup"
RETENTION_DAYS=2

# ── Timestamp ───────────────────────────────────────────
TS=$(date -u +%Y%m%d-%H%M%S)
REMOTE_TMP="/tmp/yeh_live_backup_${TS}.sql.gz"
LOCAL_FILE="${LOCAL_DIR}/yeh_live_${TS}.sql.gz"
LOCKFILE="${LOCAL_DIR}/.backup.lock"

# ── Ensure local dir exists ─────────────────────────────
mkdir -p "$LOCAL_DIR"

# ── Lock to prevent overlapping runs ────────────────────
exec 200>"$LOCKFILE"
if ! flock -n 200; then
    echo "[$(date -Iseconds)] ERROR: previous backup still running, aborting" >&2
    exit 1
fi

# ── Dump + compress remotely in one shot ────────────────
echo "[$(date -Iseconds)] Starting dump on remote..."
ssh "$SSH_HOST" bash -s << 'ENDSSH' "$REMOTE_TMP"
    set -euo pipefail
    cd /srv/yehthatrocks
    REMOTE_TMP="$1"
    docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
        /bin/sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot \
            --single-transaction --no-tablespaces --routines --skip-triggers \
            "$MYSQL_DATABASE"' \
        | gzip > "$REMOTE_TMP"
    echo "Remote dump size: $(stat -c%s "$REMOTE_TMP") bytes"
ENDSSH

# ── Pull the dump ───────────────────────────────────────
echo "[$(date -Iseconds)] Pulling dump..."
scp "${SSH_HOST}:${REMOTE_TMP}" "$LOCAL_FILE"

# ── Clean up remote temp ────────────────────────────────
ssh "$SSH_HOST" rm -f "$REMOTE_TMP"

# ── Verify local file ───────────────────────────────────
LOCAL_SIZE=$(stat -c%s "$LOCAL_FILE" 2>/dev/null || echo 0)
if [ "$LOCAL_SIZE" -lt 10000 ]; then
    echo "[$(date -Iseconds)] ERROR: local backup too small (${LOCAL_SIZE} bytes), removing" >&2
    rm -f "$LOCAL_FILE"
    exit 1
fi
echo "[$(date -Iseconds)] Backup complete: $LOCAL_FILE (${LOCAL_SIZE} bytes)"

# ── Prune old backups ───────────────────────────────────
find "$LOCAL_DIR" -name 'yeh_live_*.sql.gz' -mtime +${RETENTION_DAYS} -delete -print
echo "[$(date -Iseconds)] Prune done."

# Lock released on exit automatically
