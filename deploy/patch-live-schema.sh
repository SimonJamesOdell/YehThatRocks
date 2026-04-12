#!/usr/bin/env bash
set -euo pipefail

# Diffs live DB schema against schema.prisma (the authoritative dev state)
# and optionally applies the patch SQL.
#
# Usage:
#   bash deploy/patch-live-schema.sh             # diff only, print SQL
#   bash deploy/patch-live-schema.sh --apply     # diff + apply immediately
#   bash deploy/patch-live-schema.sh --dry-run   # alias for diff-only

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    *) echo "[patch] Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "[patch] env file not found: $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[patch] compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

cd "$REPO_DIR"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "[patch] Generating diff: live DB → schema.prisma"
set +e
PATCH_SQL="$(
  "${COMPOSE[@]}" exec -T web sh -lc \
    'npx prisma migrate diff \
       --from-url "$DATABASE_URL" \
       --to-schema-datamodel /app/prisma/schema.prisma \
       --script' 2>/dev/null
)"
DIFF_EXIT=$?
set -e

# Exit code 2 = drift; 0 = no drift; anything else = error
if [ "$DIFF_EXIT" -ne 0 ] && [ "$DIFF_EXIT" -ne 2 ]; then
  echo "[patch] prisma migrate diff failed with exit $DIFF_EXIT" >&2
  exit "$DIFF_EXIT"
fi

if [ "$DIFF_EXIT" -eq 0 ] || [ -z "$PATCH_SQL" ]; then
  echo "[patch] No drift detected — live DB already matches schema.prisma"
  exit 0
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PATCH_FILE="$REPO_DIR/logs/schema-patch-${TIMESTAMP}.sql"

mkdir -p "$REPO_DIR/logs"
printf '%s\n' "$PATCH_SQL" > "$PATCH_FILE"

echo "[patch] Drift detected. Patch SQL written to: $PATCH_FILE"
echo "---"
echo "$PATCH_SQL"
echo "---"

if [ "$APPLY" -ne 1 ]; then
  echo "[patch] Dry-run complete. To apply:"
  echo "  bash deploy/patch-live-schema.sh --apply"
  echo "  # or manually:"
  echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE exec -T web sh -lc 'npx prisma db execute --url \"\$DATABASE_URL\" --file /tmp/patch.sql'"
  exit 0
fi

echo "[patch] Applying patch SQL to live DB..."
# Copy the patch into the container and execute it so we avoid shell-quoting SQL.
CONTAINER_NAME="$("${COMPOSE[@]}" ps -q web | head -n1)"
docker cp "$PATCH_FILE" "${CONTAINER_NAME}:/tmp/schema-patch.sql"
"${COMPOSE[@]}" exec -T web sh -lc \
  'npx prisma db execute --url "$DATABASE_URL" --file /tmp/schema-patch.sql && rm /tmp/schema-patch.sql'

echo "[patch] Patch applied. Running verification..."
bash "$(dirname "$0")/verify-live-schema.sh"
