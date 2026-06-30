#!/usr/bin/env bash
set -euo pipefail

# Near-zero-downtime deploy for single-host Docker Compose setups.
# - Pulls latest code
# - Pulls prebuilt web image before swap
# - Recreates web only (keeps db/network running)
# - Waits for health endpoint
# - Rolls back to previous web image if health check fails

REPO_DIR="${REPO_DIR:-/srv/yehthatrocks}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_DIR/docker-compose.prod.yml}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
HEALTH_PATH="${HEALTH_PATH:-/api/status}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-120}"
HEALTH_REQUEST_TIMEOUT_SEC="${HEALTH_REQUEST_TIMEOUT_SEC:-5}"
LOCK_FILE="${LOCK_FILE:-/tmp/yehthatrocks-deploy.lock}"
CLEANUP_AFTER_DEPLOY="${CLEANUP_AFTER_DEPLOY:-1}"
CLEANUP_BUILDER_CACHE="${CLEANUP_BUILDER_CACHE:-1}"
CLEANUP_UNUSED_IMAGES="${CLEANUP_UNUSED_IMAGES:-1}"
SKIP_PULL="${SKIP_PULL:-0}"
ENABLE_DB_PROFILING_ON_DEPLOY="${ENABLE_DB_PROFILING_ON_DEPLOY:-0}"
DEPLOY_WARM_CATEGORY_PATHS="${DEPLOY_WARM_CATEGORY_PATHS:-1}"
DEPLOY_WARMUP_REQUIRE_SUCCESS="${DEPLOY_WARMUP_REQUIRE_SUCCESS:-1}"
DEPLOY_WARMUP_MAX_WAIT_MS="${DEPLOY_WARMUP_MAX_WAIT_MS:-90000}"
DEPLOY_WARMUP_REQUEST_TIMEOUT_MS="${DEPLOY_WARMUP_REQUEST_TIMEOUT_MS:-12000}"
DEPLOY_WARMUP_POLL_MS="${DEPLOY_WARMUP_POLL_MS:-1000}"
DEPLOY_WARMUP_INCLUDE_TAB_COUNTS="${DEPLOY_WARMUP_INCLUDE_TAB_COUNTS:-1}"
DEPLOY_WARMUP_FIRST_PAGE_LIMIT="${DEPLOY_WARMUP_FIRST_PAGE_LIMIT:-50}"
WEB_IMAGE_DEFAULT="ghcr.io/simonjamesodell/yehthatrocks-web:latest"

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] docker not found" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[deploy] git not found" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[deploy] curl not found" >&2
  exit 1
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[deploy] repo not found at $REPO_DIR" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[deploy] env file not found at $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[deploy] compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[deploy] another deploy is already running" >&2
  exit 1
fi

cd "$REPO_DIR"

# Resolve avatar host storage path from env file (with durable default outside repo).
AVATAR_HOST_PATH_FROM_ENV_FILE="$(grep -E '^AVATAR_HOST_PATH=' "$ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
AVATAR_HOST_PATH_FROM_ENV_FILE="${AVATAR_HOST_PATH_FROM_ENV_FILE//\"/}"
AVATAR_HOST_PATH_FROM_ENV_FILE="${AVATAR_HOST_PATH_FROM_ENV_FILE//\'/}"

# Ensure the avatar storage directory exists and is owned by the nextjs user
# (UID/GID 1001) that runs inside the container. Docker bind mounts create the
# directory as root if it doesn't already exist, and chown is idempotent so
# running it on every deploy keeps permissions correct after any container
# rebuild.
AVATAR_DIR="${AVATAR_HOST_PATH:-${AVATAR_HOST_PATH_FROM_ENV_FILE:-/srv/yehthatrocks-data/avatars}}"
if [ -d "$AVATAR_DIR" ] || mkdir -p "$AVATAR_DIR"; then
  chown -R 1001:1001 "$AVATAR_DIR" || echo "[deploy] WARNING: could not chown $AVATAR_DIR — avatar uploads may fail" >&2
fi

APP_PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
APP_PORT="${APP_PORT:-3000}"
APP_PORT="${APP_PORT//\"/}"
APP_PORT="${APP_PORT//\'/}"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

WEB_IMAGE_FROM_ENV_FILE="$(grep -E '^WEB_IMAGE=' "$ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
WEB_IMAGE_FROM_ENV_FILE="${WEB_IMAGE_FROM_ENV_FILE//\"/}"
WEB_IMAGE_FROM_ENV_FILE="${WEB_IMAGE_FROM_ENV_FILE//\'/}"
WEB_IMAGE="${WEB_IMAGE:-${WEB_IMAGE_FROM_ENV_FILE:-$WEB_IMAGE_DEFAULT}}"

cleanup_docker_artifacts() {
  if [ "$CLEANUP_AFTER_DEPLOY" != "1" ]; then
    echo "[deploy] cleanup disabled"
    return 0
  fi

  echo "[deploy] cleaning Docker artifacts"

  if [ "$CLEANUP_BUILDER_CACHE" = "1" ]; then
    docker builder prune -af >/dev/null 2>&1 || echo "[deploy] builder cache cleanup skipped"
  fi

  if [ "$CLEANUP_UNUSED_IMAGES" = "1" ]; then
    docker image prune -af >/dev/null 2>&1 || echo "[deploy] image cleanup skipped"
  fi
}

enable_trigger_migrations() {
  local db_container_id
  db_container_id="$("${COMPOSE[@]}" ps -q db 2>/dev/null || true)"

  if [ -z "$db_container_id" ]; then
    echo "[deploy] db container not running; cannot enable trigger migrations" >&2
    return 1
  fi

  echo "[deploy] enabling MySQL log_bin_trust_function_creators for trigger migrations"
  docker exec "$db_container_id" sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "SET GLOBAL log_bin_trust_function_creators = 1;"'
}

wait_for_public_health() {
  local status_url="$1"
  local timeout_sec="$2"
  local start_ts now_ts elapsed

  start_ts="$(date +%s)"
  while true; do
    if curl -fsS --max-time "$HEALTH_REQUEST_TIMEOUT_SEC" "$status_url" >/dev/null 2>&1; then
      return 0
    fi

    now_ts="$(date +%s)"
    elapsed="$((now_ts - start_ts))"
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      return 1
    fi

    sleep 2
  done
}

wait_for_canary_health() {
  local container_name="$1"
  local timeout_sec="$2"
  local start_ts now_ts elapsed

  start_ts="$(date +%s)"
  while true; do
    if ! docker ps --format '{{.Names}}' | grep -Fxq "$container_name"; then
      echo "[deploy] canary container is not running: $container_name" >&2
      docker logs --tail=120 "$container_name" >&2 || true
      return 1
    fi

    if docker exec "$container_name" node -e "const timeout = AbortSignal.timeout(${HEALTH_REQUEST_TIMEOUT_SEC}000); fetch('http://127.0.0.1:3000${HEALTH_PATH}', { signal: timeout }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));" >/dev/null 2>&1; then
      return 0
    fi

    now_ts="$(date +%s)"
    elapsed="$((now_ts - start_ts))"
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      echo "[deploy] canary health check timed out after ${timeout_sec}s" >&2
      docker logs --tail=120 "$container_name" >&2 || true
      return 1
    fi

    sleep 2
  done
}

warm_category_paths_in_container() {
  local container_ref="$1"
  local stage_label="$2"

  if [ "$DEPLOY_WARM_CATEGORY_PATHS" != "1" ]; then
    echo "[deploy] skipping category warmup during ${stage_label} (DEPLOY_WARM_CATEGORY_PATHS=${DEPLOY_WARM_CATEGORY_PATHS})"
    return 0
  fi

  echo "[deploy] warming category cache paths during ${stage_label}"
  local warmup_exit=0
  docker exec \
    -e WARMUP_BASE_URL="http://127.0.0.1:3000" \
    -e WARMUP_MAX_WAIT_MS="$DEPLOY_WARMUP_MAX_WAIT_MS" \
    -e WARMUP_REQUEST_TIMEOUT_MS="$DEPLOY_WARMUP_REQUEST_TIMEOUT_MS" \
    -e WARMUP_POLL_MS="$DEPLOY_WARMUP_POLL_MS" \
    -e WARMUP_INCLUDE_TAB_COUNTS="$DEPLOY_WARMUP_INCLUDE_TAB_COUNTS" \
    -e WARMUP_CATEGORY_FIRST_PAGE_LIMIT="$DEPLOY_WARMUP_FIRST_PAGE_LIMIT" \
    "$container_ref" \
    node /app/scripts/warm-category-caches.js || warmup_exit=$?

  if [ "$warmup_exit" -eq 0 ]; then
    echo "[deploy] category warmup succeeded during ${stage_label}"
    return 0
  fi

  if [ "$DEPLOY_WARMUP_REQUIRE_SUCCESS" = "1" ]; then
    echo "[deploy] category warmup failed during ${stage_label}; failing deploy (DEPLOY_WARMUP_REQUIRE_SUCCESS=1)" >&2
    return "$warmup_exit"
  fi

  echo "[deploy] WARNING: category warmup failed during ${stage_label} (non-fatal; DEPLOY_WARMUP_REQUIRE_SUCCESS=0)" >&2
  return 0
}

echo "[deploy] fetching latest refs"
git fetch origin "$TARGET_BRANCH"

echo "[deploy] switching to $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"

echo "[deploy] pulling latest commit"
git pull --ff-only origin "$TARGET_BRANCH"

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
echo "[deploy] target commit: $CURRENT_COMMIT"

PREV_CONTAINER_ID="$("${COMPOSE[@]}" ps -q web 2>/dev/null || true)"
PREV_IMAGE_ID=""
if [ -n "$PREV_CONTAINER_ID" ]; then
  PREV_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$PREV_CONTAINER_ID" 2>/dev/null || true)"
fi

if [ -n "$PREV_IMAGE_ID" ]; then
  echo "[deploy] snapshotting current web image for rollback"
  docker tag "$PREV_IMAGE_ID" yehthatrocks-web:rollback
fi

if [ "$SKIP_PULL" = "1" ]; then
  echo "[deploy] skipping image pull (SKIP_PULL=1), expecting image to already exist locally: $WEB_IMAGE"
else
  echo "[deploy] pulling web image: $WEB_IMAGE"
  WEB_IMAGE="$WEB_IMAGE" "${COMPOSE[@]}" pull web
fi

echo "[deploy] applying database migrations"
if ! enable_trigger_migrations; then
  echo "[deploy] failed to enable trigger migration compatibility" >&2
  cleanup_docker_artifacts
  exit 1
fi

# Use migration helper if available (provides better error messages and validation)
MIGRATE_HELPER="${REPO_DIR}/deploy/migrate-safely.sh"
if [ -f "$MIGRATE_HELPER" ]; then
  if ! bash "$MIGRATE_HELPER" --deploy "$(echo "${COMPOSE[@]}")" "$WEB_IMAGE" /app/prisma/schema.prisma; then
    echo "[deploy] migration failed — aborting before any traffic is affected" >&2
    cleanup_docker_artifacts
    exit 1
  fi
else
  # Fallback to basic migration if helper not available
  if ! WEB_IMAGE="$WEB_IMAGE" "${COMPOSE[@]}" run --rm --no-deps web \
      sh -c 'npx prisma migrate status --schema /app/prisma/schema.prisma; npx prisma migrate deploy --schema /app/prisma/schema.prisma'; then
    echo "[deploy] migration failed — aborting before any traffic is affected" >&2
    cleanup_docker_artifacts
    exit 1
  fi
fi
echo "[deploy] migrations applied"

STATUS_URL="http://127.0.0.1:${APP_PORT}${HEALTH_PATH}"
echo "[deploy] preflighting candidate image before swap"
CANARY_NAME="yehthatrocks-web-canary-${CURRENT_COMMIT}-$$"
cleanup_canary() {
  docker rm -f "$CANARY_NAME" >/dev/null 2>&1 || true
}
trap cleanup_canary EXIT

WEB_IMAGE="$WEB_IMAGE" "${COMPOSE[@]}" run -d --no-deps --name "$CANARY_NAME" web >/dev/null

if ! wait_for_canary_health "$CANARY_NAME" "$HEALTH_TIMEOUT_SEC"; then
  echo "[deploy] candidate image failed canary preflight; keeping current web container live" >&2
  cleanup_docker_artifacts
  exit 1
fi

if ! warm_category_paths_in_container "$CANARY_NAME" "canary preflight"; then
  echo "[deploy] canary warmup failed; keeping current web container live" >&2
  cleanup_docker_artifacts
  exit 1
fi

echo "[deploy] canary passed; swapping web container"
WEB_IMAGE="$WEB_IMAGE" "${COMPOSE[@]}" up -d --no-deps web

echo "[deploy] verifying live health after swap: $STATUS_URL"
if wait_for_public_health "$STATUS_URL" "$HEALTH_TIMEOUT_SEC"; then
  echo "[deploy] health check passed"

  WEB_CONTAINER_ID="$(${COMPOSE[@]} ps -q web 2>/dev/null || true)"
  if [ -n "$WEB_CONTAINER_ID" ]; then
    if ! warm_category_paths_in_container "$WEB_CONTAINER_ID" "post-swap live container"; then
      echo "[deploy] live container warmup failed" >&2
      cleanup_docker_artifacts
      exit 1
    fi
  else
    echo "[deploy] WARNING: could not resolve live web container id for post-swap warmup" >&2
  fi

  if [ "$ENABLE_DB_PROFILING_ON_DEPLOY" = "1" ] && [ -f "$REPO_DIR/deploy/start-db-profiling.sh" ]; then
    echo "[deploy] enabling db profiling (ENABLE_DB_PROFILING_ON_DEPLOY=1)"
    REPO_DIR="$REPO_DIR" ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" \
      bash "$REPO_DIR/deploy/start-db-profiling.sh" || echo "[deploy] WARNING: db profiling start failed — run: bash deploy/start-db-profiling.sh" >&2
  fi
  cleanup_docker_artifacts
  echo "[deploy] deploy complete: $CURRENT_COMMIT"
  if [ -f "$REPO_DIR/deploy/verify-live-schema.sh" ]; then
    echo "[deploy] verifying schema parity"
    if REPO_DIR="$REPO_DIR" ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" \
      bash "$REPO_DIR/deploy/verify-live-schema.sh"; then
      echo "[deploy] schema verification passed"
    else
      if [ "${ALLOW_SCHEMA_VERIFY_WARN_ONLY:-0}" = "1" ]; then
        echo "[deploy] WARNING: schema verification failed (ALLOW_SCHEMA_VERIFY_WARN_ONLY=1)" >&2
      else
        echo "[deploy] schema verification failed — failing deploy to prevent app/schema drift" >&2
        exit 1
      fi
    fi
  fi

  # Install/refresh magazine autogen systemd timer (runs every 6 hours)
  if [ -d "$REPO_DIR/deploy/systemd" ] && command -v systemctl >/dev/null 2>&1; then
    echo "[deploy] installing magazine-autogen systemd timer"
    cp "$REPO_DIR/deploy/systemd/magazine-autogen.service" /etc/systemd/system/magazine-autogen.service
    cp "$REPO_DIR/deploy/systemd/magazine-autogen.timer" /etc/systemd/system/magazine-autogen.timer
    systemctl daemon-reload
    systemctl enable --now magazine-autogen.timer
    echo "[deploy] validating magazine-autogen.service"
    if systemctl start magazine-autogen.service; then
      echo "[deploy] magazine-autogen.service smoke run passed"
    else
      echo "[deploy] WARNING: magazine-autogen.service smoke run failed (non-fatal — timer will retry on schedule)" >&2
      journalctl -u magazine-autogen.service -n 40 --no-pager >&2 || true
    fi
    TIMER_NEXT_ELAPSE="$(systemctl show magazine-autogen.timer --property=NextElapseUSecRealtime --value || true)"
    if [ -z "$TIMER_NEXT_ELAPSE" ] || [ "$TIMER_NEXT_ELAPSE" = "n/a" ]; then
      echo "[deploy] WARNING: magazine-autogen.timer next-run value unavailable from systemctl show" >&2
      systemctl status magazine-autogen.timer --no-pager >&2 || true
    else
      echo "[deploy] magazine-autogen.timer enabled (every 6h), next run at: $TIMER_NEXT_ELAPSE"
    fi

    echo "[deploy] installing daily-discovery systemd timer"
    cp "$REPO_DIR/deploy/systemd/daily-discovery.service" /etc/systemd/system/daily-discovery.service
    cp "$REPO_DIR/deploy/systemd/daily-discovery.timer" /etc/systemd/system/daily-discovery.timer
    systemctl daemon-reload
    systemctl enable --now daily-discovery.timer
    echo "[deploy] validating daily-discovery.service"
    if systemctl start daily-discovery.service; then
      echo "[deploy] daily-discovery.service smoke run passed"
    else
      echo "[deploy] WARNING: daily-discovery.service smoke run failed (non-fatal — timer will retry on schedule)" >&2
      journalctl -u daily-discovery.service -n 40 --no-pager >&2 || true
    fi
    DAILY_DISCOVERY_TIMER_NEXT_ELAPSE="$(systemctl show daily-discovery.timer --property=NextElapseUSecRealtime --value || true)"
    if [ -z "$DAILY_DISCOVERY_TIMER_NEXT_ELAPSE" ] || [ "$DAILY_DISCOVERY_TIMER_NEXT_ELAPSE" = "n/a" ]; then
      echo "[deploy] WARNING: daily-discovery.timer next-run value unavailable from systemctl show" >&2
      systemctl status daily-discovery.timer --no-pager >&2 || true
    else
      echo "[deploy] daily-discovery.timer enabled (daily at 04:00 UTC), next run at: $DAILY_DISCOVERY_TIMER_NEXT_ELAPSE"
    fi

    echo "[deploy] installing admin-dashboard-cache-maintenance systemd timer"
    cp "$REPO_DIR/deploy/systemd/admin-dashboard-cache-maintenance.service" /etc/systemd/system/admin-dashboard-cache-maintenance.service
    cp "$REPO_DIR/deploy/systemd/admin-dashboard-cache-maintenance.timer" /etc/systemd/system/admin-dashboard-cache-maintenance.timer
    systemctl daemon-reload
    systemctl enable --now admin-dashboard-cache-maintenance.timer
    echo "[deploy] validating admin-dashboard-cache-maintenance.service"
    if systemctl start admin-dashboard-cache-maintenance.service; then
      echo "[deploy] admin-dashboard-cache-maintenance.service smoke run passed"
    else
      echo "[deploy] WARNING: admin-dashboard-cache-maintenance.service smoke run failed (non-fatal - timer will retry on schedule)" >&2
      journalctl -u admin-dashboard-cache-maintenance.service -n 40 --no-pager >&2 || true
    fi
    ADMIN_TIMER_NEXT_ELAPSE="$(systemctl show admin-dashboard-cache-maintenance.timer --property=NextElapseUSecRealtime --value || true)"
    if [ -z "$ADMIN_TIMER_NEXT_ELAPSE" ] || [ "$ADMIN_TIMER_NEXT_ELAPSE" = "n/a" ]; then
      echo "[deploy] WARNING: admin-dashboard-cache-maintenance.timer next-run value unavailable from systemctl show" >&2
      systemctl status admin-dashboard-cache-maintenance.timer --no-pager >&2 || true
    else
      echo "[deploy] admin-dashboard-cache-maintenance.timer enabled (every 5m), next run at: $ADMIN_TIMER_NEXT_ELAPSE"
    fi
  fi

  exit 0
fi

echo "[deploy] post-swap health check timed out after ${HEALTH_TIMEOUT_SEC}s" >&2
if docker image inspect yehthatrocks-web:rollback >/dev/null 2>&1; then
  echo "[deploy] rolling back to previous image"
  WEB_IMAGE="yehthatrocks-web:rollback" "${COMPOSE[@]}" up -d --no-deps web

  if wait_for_public_health "$STATUS_URL" "$HEALTH_TIMEOUT_SEC"; then
    echo "[deploy] rollback succeeded" >&2
  else
    echo "[deploy] rollback attempted, but health endpoint is still failing" >&2
  fi
else
  echo "[deploy] rollback image not available" >&2
fi

# Cleanup should also run on failure to avoid accumulating unused images.
cleanup_docker_artifacts
exit 1
