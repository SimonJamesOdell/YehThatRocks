#!/usr/bin/env bash
set -euo pipefail

# Installs the YehThatRocks Nginx site config with maintenance page support.
# Run on VPS: sudo bash deploy/nginx/install-nginx-config.sh

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
CONF_SRC="$REPO_DIR/deploy/nginx/yehthatrocks.conf"
LOGGING_CONF_SRC="$REPO_DIR/deploy/nginx/yehthatrocks-logging.conf"
SITES_AVAILABLE="/etc/nginx/sites-available/yehthatrocks"
SITES_ENABLED="/etc/nginx/sites-enabled/yehthatrocks"
LOGGING_CONF_DEST="/etc/nginx/conf.d/yehthatrocks-logging.conf"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/etc/nginx/sites-available/yehthatrocks-backup-$TIMESTAMP"
CANDIDATE_PATH="${SITES_AVAILABLE}.candidate.${TIMESTAMP}"
PREVIOUS_ENABLED_TARGET=""

if [ ! -f "$CONF_SRC" ]; then
  echo "[nginx-install] config not found at $CONF_SRC" >&2
  exit 1
fi

if [ ! -f "$LOGGING_CONF_SRC" ]; then
  echo "[nginx-install] logging config not found at $LOGGING_CONF_SRC" >&2
  exit 1
fi

restore_enabled_link() {
  if [ -n "$PREVIOUS_ENABLED_TARGET" ] && [ -e "$PREVIOUS_ENABLED_TARGET" ]; then
    ln -sf "$PREVIOUS_ENABLED_TARGET" "$SITES_ENABLED"
    return
  fi

  rm -f "$SITES_ENABLED"
}

cleanup_candidate() {
  rm -f "$CANDIDATE_PATH"
}

trap 'restore_enabled_link; cleanup_candidate' ERR

mkdir -p "$BACKUP_DIR"

if [ -e "$SITES_AVAILABLE" ]; then
  cp -a "$SITES_AVAILABLE" "$BACKUP_DIR/yehthatrocks"
fi

if [ -e "$LOGGING_CONF_DEST" ]; then
  cp -a "$LOGGING_CONF_DEST" "$BACKUP_DIR/yehthatrocks-logging.conf"
fi

if [ -e "$SITES_ENABLED" ] || [ -L "$SITES_ENABLED" ]; then
  cp -a "$SITES_ENABLED" "$BACKUP_DIR/yehthatrocks.enabled"
fi

if [ -L "$SITES_ENABLED" ]; then
  PREVIOUS_ENABLED_TARGET="$(readlink -f "$SITES_ENABLED" || true)"
fi

echo "[nginx-install] Backed up existing config to $BACKUP_DIR"

echo "[nginx-install] Installing candidate config to $CANDIDATE_PATH"
cp "$CONF_SRC" "$CANDIDATE_PATH"

echo "[nginx-install] Installing logging include to $LOGGING_CONF_DEST"
cp "$LOGGING_CONF_SRC" "$LOGGING_CONF_DEST"

echo "[nginx-install] Testing candidate site config"
ln -sf "$CANDIDATE_PATH" "$SITES_ENABLED"

nginx -t

echo "[nginx-install] Promoting candidate config to $SITES_AVAILABLE"
mv "$CANDIDATE_PATH" "$SITES_AVAILABLE"

echo "[nginx-install] Enabling validated site config"
ln -sf "$SITES_AVAILABLE" "$SITES_ENABLED"

trap - ERR

echo "[nginx-install] Reloading Nginx"
systemctl reload nginx

echo "[nginx-install] Done. Maintenance page active on 502/503/504. Backup stored at $BACKUP_DIR."
