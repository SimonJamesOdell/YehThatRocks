#!/usr/bin/env bash
#
# Installs host-level `ship` and `fast` commands on Linux, wired to the repo's
# deploy/ship.sh (the Linux port of the Windows ship.cmd + ship-local.ps1 flow).
#
# The commands are written as thin shims into ~/.local/bin so they survive git
# pulls and always run the version in the repo. ~/.local/bin is added to PATH
# (in ~/.bashrc / ~/.profile) when missing, and YTR_VPS_HOST is persisted.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TARGET_BIN_DIR="${TARGET_BIN_DIR:-$HOME/.local/bin}"
VPS_HOST="${VPS_HOST:-root@206.189.122.114}"

SHIP_SH="$REPO_DIR/deploy/ship.sh"

if [ ! -f "$SHIP_SH" ]; then
  echo "[install-ship] ship.sh not found at $SHIP_SH" >&2
  exit 1
fi

mkdir -p "$TARGET_BIN_DIR"

cat > "$TARGET_BIN_DIR/ship" <<EOF
#!/usr/bin/env bash
exec "$SHIP_SH" "\$@"
EOF

cat > "$TARGET_BIN_DIR/fast" <<EOF
#!/usr/bin/env bash
exec "$SHIP_SH" fast "\$@"
EOF

chmod 0755 "$TARGET_BIN_DIR/ship" "$TARGET_BIN_DIR/fast"

# Ensure the bin dir is on PATH (idempotent).
case ":$PATH:" in
  *":$TARGET_BIN_DIR:"*) ;;
  *)
    for rc in "$HOME/.bashrc" "$HOME/.profile"; do
      if [ -f "$rc" ] && ! grep -qF "export PATH=\"$TARGET_BIN_DIR:\$PATH\"" "$rc"; then
        printf 'export PATH="%s:$PATH"\n' "$TARGET_BIN_DIR" >> "$rc"
        echo "[install-ship] added $TARGET_BIN_DIR to PATH in $rc"
      fi
    done
    ;;
esac

# Persist YTR_VPS_HOST (idempotent) so bare `ship` runs target the right host.
if [ -f "$HOME/.bashrc" ] && ! grep -qE '^export YTR_VPS_HOST=' "$HOME/.bashrc"; then
  printf 'export YTR_VPS_HOST="%s"\n' "$VPS_HOST" >> "$HOME/.bashrc"
  echo "[install-ship] saved YTR_VPS_HOST=$VPS_HOST in ~/.bashrc"
fi

echo "[install-ship] installed 'ship' and 'fast' at $TARGET_BIN_DIR"
echo "[install-ship] usage:"
echo "  ship SECRET_PASSWORD          # regular (npm audit + full ship)"
echo "  ship fast SECRET_PASSWORD     # minimal ship"
echo "  ship slow SECRET_PASSWORD     # full ship (dependency maintenance)"
echo "  ship vps SECRET_PASSWORD      # build on the VPS (no local Docker)"
echo "  fast SECRET_PASSWORD          # same as 'ship fast'"
echo "[install-ship] start a new shell (or: source ~/.bashrc) to pick up PATH changes"
