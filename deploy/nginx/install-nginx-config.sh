#!/usr/bin/env bash
set -euo pipefail

# Installs the YehThatRocks Nginx site config with maintenance page support.
# Run on VPS: sudo bash deploy/nginx/install-nginx-config.sh

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
CONF_SRC="$REPO_DIR/deploy/nginx/yehthatrocks.conf"
SITES_AVAILABLE="/etc/nginx/sites-available/yehthatrocks"
SITES_ENABLED="/etc/nginx/sites-enabled/yehthatrocks"

if [ ! -f "$CONF_SRC" ]; then
  echo "[nginx-install] config not found at $CONF_SRC" >&2
  exit 1
fi

echo "[nginx-install] Installing site config to $SITES_AVAILABLE"
cp "$CONF_SRC" "$SITES_AVAILABLE"

echo "[nginx-install] Enabling site"
ln -sf "$SITES_AVAILABLE" "$SITES_ENABLED"

echo "[nginx-install] Testing Nginx config"
nginx -t

echo "[nginx-install] Reloading Nginx"
systemctl reload nginx

echo "[nginx-install] Done. Maintenance page active on 502/503/504."
