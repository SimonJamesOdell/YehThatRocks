#!/usr/bin/env bash
#
# ship.sh — Linux port of the Windows ship flow (ship.cmd + deploy/ship-local.ps1).
#
# Usage (mirrors the Windows commands exactly):
#   ship [mode] <password> [flags]
#   fast <password> [flags]      (equivalent to: ship fast <password>)
#
# Modes (first positional arg, optional):
#   (none)   regular — npm audit + full ship except auto-dependency-maintenance
#   slow     full ship (dependency maintenance, migration validation, cleanup,
#            docker prune, verify gate all enabled) — no npm audit
#   fast     skip auto-dependency-maintenance, migration validation, local
#            cleanup, docker prune, and the verify gate
#   vps      build the image on the VPS (no local Docker build/transfer)
#
# Password:
#   First run (no .ship-password.json) prompts to create a salted-hash password.
#   Subsequent runs require the password as the positional argument.
#
# Flags (after the password):
#   --branch=X            git branch to ship (default: main)
#   --vps-host=X          SSH host (default: $YTR_VPS_HOST or root@206.189.122.114)
#   --vps-repo-dir=X      VPS repo path (default: /srv/yehthatrocks)
#   --image-base=X        docker image base name (default: yehthatrocks-web)
#   --skip-git-push       do not push to origin
#   --restore-db          dump local DB and restore it on the VPS before deploy
#   --resume              resume from a checkpointed (interrupted) ship run
#   --force-full-cleanup-stop-dev-server   stop the dev server before cleanup
#   --skip-auto-dependency-maintenance
#   --skip-migration-validation
#   --skip-local-cleanup
#   --skip-docker-prune
#   --skip-verify-gate
#   --vps-build
#   --local-build
#
# Build location (default: auto):
#   When neither --vps-build nor --local-build is given, ship uses a local Docker
#   build if the Docker daemon is available, and otherwise falls back to building
#   the image on the VPS (same as 'ship vps'). The production server runs Docker,
#   so a local Docker install is NOT required to ship from Linux — only if you
#   want to build the image on this machine instead of on the VPS.
#
# Linux note: automatic dependency maintenance (scripts/maintain-dependencies.ps1)
# is PowerShell-only and is skipped on Linux with a warning. Everything else is
# fully functional.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and defaults
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

BRANCH="main"
VPS_HOST="${YTR_VPS_HOST:-root@206.189.122.114}"
VPS_REPO_DIR="/srv/yehthatrocks"
IMAGE_BASE="yehthatrocks-web"
SKIP_GIT_PUSH=0
RESTORE_DB=0
SKIP_LOCAL_CLEANUP=0
FORCE_FULL_CLEANUP_STOP_DEV_SERVER=0
SKIP_DOCKER_PRUNE=0
SKIP_AUTO_DEPENDENCY_MAINTENANCE=0
SKIP_MIGRATION_VALIDATION=0
SKIP_VERIFY_GATE=0
RESUME=0
VPS_BUILD=0
LOCAL_BUILD_REQUESTED=0
MODE="regular"
SHIP_PASSWORD=""

# ---------------------------------------------------------------------------
# Log helpers
# ---------------------------------------------------------------------------
info()  { printf '\033[0;36m[ship]\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m[ship]\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m[ship]\033[0m %s\n' "$*" >&2; exit 1; }

run() { info "> $*"; "$@"; }

run_retry() {
  local max_attempts="${1:-5}" initial_delay="${2:-4}"
  shift 2
  local attempt=1 delay="$initial_delay"
  while [ "$attempt" -le "$max_attempts" ]; do
    info "> $*"
    if "$@"; then return 0; fi
    warn "command failed (attempt $attempt/$max_attempts): $*"
    attempt=$((attempt + 1))
    sleep "$delay"
    delay=$((delay * 2)); [ "$delay" -gt 30 ] && delay=30
  done
  error "command failed after $max_attempts attempts: $*"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
if [ "$#" -ge 1 ]; then
  case "$1" in
    fast) MODE="fast"; shift ;;
    slow) MODE="slow"; shift ;;
    vps)  MODE="vps";  shift ;;
  esac
fi

# Optional positional password (only when the next arg is not a --flag)
if [ "$#" -ge 1 ]; then
  case "$1" in
    --*) : ;;          # first positional is already a flag → no password arg
    *) SHIP_PASSWORD="$1"; shift ;;
  esac
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch=*)            BRANCH="${1#*=}"; shift ;;
    --branch)              BRANCH="$2"; shift 2 ;;
    --vps-host=*)          VPS_HOST="${1#*=}"; shift ;;
    --vps-host)            VPS_HOST="$2"; shift 2 ;;
    --vps-repo-dir=*)      VPS_REPO_DIR="${1#*=}"; shift ;;
    --vps-repo-dir)        VPS_REPO_DIR="$2"; shift 2 ;;
    --image-base=*)        IMAGE_BASE="${1#*=}"; shift ;;
    --image-base)          IMAGE_BASE="$2"; shift 2 ;;
    --skip-git-push)       SKIP_GIT_PUSH=1; shift ;;
    --restore-db)          RESTORE_DB=1; shift ;;
    --resume)              RESUME=1; shift ;;
    --force-full-cleanup-stop-dev-server) FORCE_FULL_CLEANUP_STOP_DEV_SERVER=1; shift ;;
    --skip-auto-dependency-maintenance) SKIP_AUTO_DEPENDENCY_MAINTENANCE=1; shift ;;
    --skip-migration-validation)        SKIP_MIGRATION_VALIDATION=1; shift ;;
    --skip-local-cleanup)               SKIP_LOCAL_CLEANUP=1; shift ;;
    --skip-docker-prune)                SKIP_DOCKER_PRUNE=1; shift ;;
    --skip-verify-gate)                 SKIP_VERIFY_GATE=1; shift ;;
    --vps-build)           VPS_BUILD=1; shift ;;
    --local-build)         LOCAL_BUILD_REQUESTED=1; shift ;;
    *) error "Unknown argument: $1" ;;
  esac
done

# Apply mode semantics (mirrors ship.cmd)
case "$MODE" in
  fast)
    SKIP_AUTO_DEPENDENCY_MAINTENANCE=1
    SKIP_MIGRATION_VALIDATION=1
    SKIP_LOCAL_CLEANUP=1
    SKIP_DOCKER_PRUNE=1
    SKIP_VERIFY_GATE=1
    ;;
  regular)
    SKIP_AUTO_DEPENDENCY_MAINTENANCE=1
    ;;
  vps)
    VPS_BUILD=1
    SKIP_AUTO_DEPENDENCY_MAINTENANCE=1
    SKIP_LOCAL_CLEANUP=1
    SKIP_DOCKER_PRUNE=1
    ;;
  slow) : ;;   # nothing skipped
esac

# ---------------------------------------------------------------------------
# Ship password gate (.ship-password.json — salted SHA-256, cross-compatible
# with the Windows script: hash = base64(sha256(base64decode(salt) || password))
# ---------------------------------------------------------------------------
ship_hash() {
  local salt_b64="$1" password="$2"
  { printf '%s' "$salt_b64" | base64 -d 2>/dev/null; printf '%s' "$password"; } \
    | openssl dgst -sha256 -binary \
    | base64 -w0
}

create_ship_password_file() {
  local password="$1"
  local salt hash
  salt="$(head -c 32 /dev/urandom | base64 -w0)"
  hash="$(ship_hash "$salt" "$password")"
  printf '{"version":1,"salt":"%s","hash":"%s","createdAtUtc":"%s"}\n' \
    "$salt" "$hash" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$REPO_DIR/.ship-password.json"
  chmod 600 "$REPO_DIR/.ship-password.json"
}

password_gate() {
  local pw_file="$REPO_DIR/.ship-password.json"

  if [ ! -f "$pw_file" ]; then
    # First run: set up the password.
    if [ -n "$SHIP_PASSWORD" ]; then
      # A password was passed as an argument — use it directly.
      create_ship_password_file "$SHIP_PASSWORD"
      info "Ship password initialized at $pw_file"
      info "Re-run using: ship SECRET_PASSWORD"
      exit 0
    fi

    info "No ship password configured. Creating one now (this run exits after saving)."
    local p1 p2
    read -rsp "Enter new ship password: " p1; echo
    read -rsp "Confirm new ship password: " p2; echo
    [ -n "$p1" ] || error "Ship password cannot be empty."
    [ "$p1" = "$p2" ] || error "Ship password confirmation did not match."
    create_ship_password_file "$p1"
    info "Ship password initialized at $pw_file"
    info "Re-run using: ship SECRET_PASSWORD"
    exit 0
  fi

  # Existing file: prompt for the password when none was passed as an argument,
  # so a bare `ship` behaves like `sudo` instead of erroring out.
  if [ -z "$SHIP_PASSWORD" ]; then
    read -rsp "Enter ship password: " SHIP_PASSWORD || true
    echo
  fi
  [ -n "$SHIP_PASSWORD" ] || error "password required"

  local salt expected actual
  salt="$(sed -n 's/.*"salt":"\([^"]*\)".*/\1/p' "$pw_file")"
  expected="$(sed -n 's/.*"hash":"\([^"]*\)".*/\1/p' "$pw_file")"
  [ -n "$salt" ] && [ -n "$expected" ] || error "Invalid ship password file at $pw_file"

  actual="$(ship_hash "$salt" "$SHIP_PASSWORD")"
  if [ "$actual" != "$expected" ]; then
    error "incorrect password"
  fi
}

# ---------------------------------------------------------------------------
# Tool checks
# ---------------------------------------------------------------------------
docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

require_ssh() {
  command -v ssh >/dev/null 2>&1 || error "ssh command not found. Install OpenSSH client."
}

# ---------------------------------------------------------------------------
# Clean worktree gate
# ---------------------------------------------------------------------------
remove_untracked_empty_dirs() {
  git clean -nd 2>/dev/null | while IFS= read -r line; do
    case "$line" in
      "Would remove "*/)
        local dir="${line#Would remove }"; dir="${dir%/}"
        if [ -n "$dir" ] && [ -d "$dir" ] && [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
          warn "Removing untracked empty directory: $dir"
          rmdir "$dir" 2>/dev/null || true
        fi
        ;;
    esac
  done
}

clean_worktree_gate() {
  local status clean
  status="$(git status --porcelain)"
  if [ -n "$status" ]; then
    error "Working tree is not clean. Commit or stash your changes before running ship.

Pending changes:
$status"
  fi

  clean="$(git clean -nd 2>/dev/null)"
  if [ -n "$clean" ]; then
    error "Working tree has untracked files or empty directories not in .gitignore.
These would be included in the Docker build context and may corrupt the image.
Remove them (or add to .gitignore) before running ship:

$clean"
  fi
}

# ---------------------------------------------------------------------------
# Local dev server + transient cache cleanup
# ---------------------------------------------------------------------------
dev_server_pid() {
  local pid=""
  if command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -t -i :3000 -sTCP:LISTEN 2>/dev/null | head -n1)"
  elif command -v fuser >/dev/null 2>&1; then
    pid="$(fuser 3000/tcp 2>/dev/null | tr -s ' ' '\n' | head -n1)"
  elif command -v ss >/dev/null 2>&1; then
    pid="$(ss -ltnp 'sport = :3000' 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -n1)"
  fi
  # Guard: only treat node/npm/yarn/bun processes as the dev server.
  if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
    local comm=""
    comm="$(cat "/proc/$pid/comm" 2>/dev/null || true)"
    case "$comm" in
      node|npm|pnpm|yarn|bun) echo "$pid" ;;
      *) : ;;
    esac
  fi
}

stop_dev_server() {
  local pid
  pid="$(dev_server_pid)"
  if [ -z "$pid" ]; then return 1; fi
  warn "Stopping local dev server (PID $pid) before cache cleanup..."
  kill "$pid" 2>/dev/null || true
  local waited=0
  while [ "$(dev_server_pid)" != "" ] && [ "$waited" -lt 5 ]; do
    sleep 0.4
    waited=1
  done
  return 0
}

start_dev_server() {
  warn "Restarting local dev server..."
  local candidate
  for candidate in "npm run dev" "npm -w web run dev"; do
    warn "Trying dev restart command: $candidate"
    # shellcheck disable=SC2086
    nohup $candidate >/tmp/ytr-dev-server.log 2>&1 &
    local started=0 i
    for i in $(seq 1 40); do
      sleep 0.25
      if [ "$(dev_server_pid)" != "" ]; then started=1; break; fi
    done
    if [ "$started" -eq 1 ]; then
      warn "Dev server restarted using '$candidate'."
      return
    fi
  done
  warn "Dev server did not come back on port 3000 after ship. Tried: npm run dev, npm -w web run dev"
}

clean_path() {
  local target="$1"
  if [ -e "$target" ]; then
    warn "Cleaning local cache path: $target"
    rm -rf "$target"
  fi
}

clean_repo_transient_caches() {
  local safe_mode="${1:-0}"
  if [ "$safe_mode" -eq 1 ]; then
    clean_path "apps/web/.cache"
    clean_path "playwright-report"
    clean_path "test-results"
  else
    clean_path ".next"
    clean_path "apps/web/.next"
    clean_path "apps/web/.cache"
    clean_path "playwright-report"
    clean_path "test-results"
    clean_path "logs"
  fi
}

# ---------------------------------------------------------------------------
# Ship state (checkpoint / resume)
# ---------------------------------------------------------------------------
ship_state_dir() {
  local repo_key
  repo_key="$(printf '%s' "$REPO_DIR" | sha256sum | cut -c1-12)"
  echo "${XDG_STATE_HOME:-$HOME/.local/share}/ytr/ship-state/$repo_key"
}

state_get() { sed -n 's/.*"'$2'":"\([^"]*\)".*/\1/p' "$1"; }

stage_rank() {
  case "$1" in
    init) echo 0 ;;
    gates-passed) echo 1 ;;
    image-built) echo 2 ;;
    tar-saved) echo 3 ;;
    tar-uploaded) echo 4 ;;
    image-loaded) echo 5 ;;
    deployed) echo 6 ;;
    *) echo -1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Remote helpers
# ---------------------------------------------------------------------------
upload_image_tar() {
  local local_tar="$1" remote_tar="$2"
  local local_size local_hash remote_size remote_hash attempts=0
  local_size="$(stat -c %s "$local_tar")"
  local_hash="$(sha256sum "$local_tar" | awk '{print $1}')"

  while [ "$attempts" -lt 12 ]; do
    attempts=$((attempts + 1))
    info "Uploading image archive to VPS (attempt $attempts/12)..."
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --partial --inplace "$local_tar" "$VPS_HOST:$remote_tar" >/dev/null 2>&1 || true
    else
      scp -o BatchMode=yes "$local_tar" "$VPS_HOST:$remote_tar" >/dev/null 2>&1 || true
    fi

    remote_size="$(ssh -o BatchMode=yes "$VPS_HOST" "stat -c %s '$remote_tar' 2>/dev/null" || echo 0)"
    remote_hash="$(ssh -o BatchMode=yes "$VPS_HOST" "sha256sum '$remote_tar' 2>/dev/null" | cut -d' ' -f1)"

    if [ "$remote_size" = "$local_size" ] && [ "$remote_hash" = "$local_hash" ]; then
      info "Image archive uploaded and verified on VPS ($(( local_size / 1024 / 1024 )) MB)."
      return 0
    fi

    if [ "$remote_size" = "$local_size" ] && [ "$remote_hash" != "$local_hash" ]; then
      warn "Uploaded archive failed SHA-256 verification; discarding remote file and restarting."
      ssh -o BatchMode=yes "$VPS_HOST" "rm -f '$remote_tar'" >/dev/null 2>&1 || true
    else
      warn "Upload incomplete (local $local_size, remote $remote_size); resuming in 3s..."
    fi
    sleep 3
  done
  error "Image upload to VPS did not complete after 12 attempts."
}

# ---------------------------------------------------------------------------
# Deploy (hot-swap) on the VPS
# ---------------------------------------------------------------------------
deploy_hot_swap() {
  local image_tag="$1"
  info "Triggering VPS hot-swap deploy ($image_tag)..."
  ssh -o BatchMode=yes "$VPS_HOST" "bash -s" <<REMOTE
set -e
cd "$VPS_REPO_DIR"
if [ -n "\$(git status --porcelain)" ]; then
  echo "[ship] WARNING: VPS repo has local changes; auto-stashing before deploy"
  git stash push --include-untracked -m "ship-auto-stash \$(date -Iseconds)" >/dev/null
fi
WEB_IMAGE="$image_tag" SKIP_PULL=1 ./deploy/deploy-prod-hot-swap.sh
REMOTE
}

# ---------------------------------------------------------------------------
# VPS build (build the image on the VPS instead of locally)
# ---------------------------------------------------------------------------
vps_build_and_deploy() {
  local image_tag="$1" latest_tag="$2" commit_sha="$3"
  local log_path="/tmp/ytr-deploy-$commit_sha.log"

  local chain
  chain="cd $VPS_REPO_DIR && git fetch origin && git checkout $commit_sha && nice -n 19 ionice -c3 docker build --progress=plain --build-arg NODE_MAX_OLD_SPACE_SIZE=1536 --build-arg TURBO_CONCURRENCY=1 -t $image_tag -t $latest_tag . && WEB_IMAGE=$image_tag SKIP_PULL=1 ./deploy/deploy-prod-hot-swap.sh && echo YTR_DEPLOY_OK || echo YTR_DEPLOY_FAILED"

  info "Launching build + deploy on VPS (fire-and-forget)..."
  info "  Log: $VPS_HOST:$log_path"
  ssh -o BatchMode=yes "$VPS_HOST" "nohup sh -c '$chain' > $log_path 2>&1 &"

  info "Waiting for VPS build + deploy (connection-safe)..."
  info "  Manual check: ssh $VPS_HOST tail -f $log_path"
  echo ""

  local last_line=1 max_wait=2400 poll_interval=5 elapsed=0 poll_failures=0 tail_out
  while [ "$elapsed" -lt "$max_wait" ]; do
    if ! tail_out="$(ssh -o BatchMode=yes "$VPS_HOST" "tail -n +$last_line $log_path 2>/dev/null" 2>/dev/null)"; then
      poll_failures=$((poll_failures + 1))
      warn "SSH connection lost while polling — build continues on VPS. Poll failure $poll_failures/5..."
      if [ "$poll_failures" -ge 5 ]; then
        info "  Check progress: ssh $VPS_HOST tail -f $log_path"
        info "  Once complete, deploy is already live. No further action needed."
        return 0
      fi
      sleep "$poll_interval"; elapsed=$((elapsed + poll_interval)); continue
    fi
    poll_failures=0

    if [ -n "$tail_out" ]; then
      printf '%s\n' "$tail_out"
      last_line=$((last_line + $(printf '%s\n' "$tail_out" | wc -l)))
    fi

    if printf '%s\n' "$tail_out" | grep -q "YTR_DEPLOY_OK"; then
      echo ""
      info "VPS build + deploy complete: $image_tag"
      return 0
    fi
    if printf '%s\n' "$tail_out" | grep -q "YTR_DEPLOY_FAILED"; then
      error "VPS build or deploy failed. Full log: ssh $VPS_HOST cat $log_path"
    fi

    sleep "$poll_interval"; elapsed=$((elapsed + poll_interval))
  done

  error "Timed out waiting for VPS build after $max_wait seconds. Check log: ssh $VPS_HOST cat $log_path"
}

# ---------------------------------------------------------------------------
# Verification gate (build + invariants + API smoke against a warm server)
# ---------------------------------------------------------------------------
run_verify_gate() {
  info "Running pre-deploy verification gates..."

  # Regenerate the Prisma client before the local build. Prisma 7 no longer
  # auto-generates on `npm install`, so a fresh checkout (or a schema change)
  # otherwise fails `verify:compile` with "no exported member 'PrismaClient'".
  run npx prisma generate

  run npm run verify:compile

  local server_js="$REPO_DIR/apps/web/.next/standalone/apps/web/server.js"
  local env_file="$REPO_DIR/apps/web/.env.local"
  local test_port=3100
  local base_url="http://127.0.0.1:$test_port"

  [ -f "$server_js" ] || error "Standalone server not found at $server_js after build."

  local db_url="" jwt_secret=""
  if [ -f "$env_file" ]; then
    db_url="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$env_file" | head -n1 | tr -d '"'"'"'')"
    jwt_secret="$(sed -n 's/^[[:space:]]*AUTH_JWT_SECRET[[:space:]]*=[[:space:]]*//p' "$env_file" | head -n1 | tr -d '"'"'"'')"
  fi
  [ -n "$db_url" ] || db_url="${DATABASE_URL:-}"
  [ -n "$jwt_secret" ] || jwt_secret="${AUTH_JWT_SECRET:-}"
  [ -n "$db_url" ] || error "DATABASE_URL is not set. Add it to apps/web/.env.local or your shell."
  [ -n "$jwt_secret" ] || error "AUTH_JWT_SECRET is not set. Add it to apps/web/.env.local or your shell."

  # Kill any stale process on the test port
  local stale
  stale="$(lsof -t -i ":$test_port" 2>/dev/null | head -n1)"
  [ -z "$stale" ] || kill "$stale" 2>/dev/null || true

  info "Starting production test server on port $test_port..."
  NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$test_port" \
    DATABASE_URL="$db_url" AUTH_JWT_SECRET="$jwt_secret" \
    NEXT_PUBLIC_DISABLE_DESKTOP_INTRO=1 \
    node "$server_js" >/tmp/ytr-test-server-stdout.log 2>/tmp/ytr-test-server-stderr.log &
  local test_server_pid=$!
  info "Test server PID: $test_server_pid"

  local ready=0 last_error="" i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 10 "$base_url/api/status" >/dev/null 2>&1; then
      ready=1; break
    fi
    last_error="not ready"
    sleep 1
  done

  if [ "$ready" -ne 1 ]; then
    kill "$test_server_pid" 2>/dev/null || true
    error "Test server did not become ready within 60s."
  fi
  info "Test server ready."

  run npm run verify:ui-regressions

  local smoke_scripts=(
    "scripts/verify-core-experience-api-smoke.js"
    "scripts/verify-new-videos-api-smoke.js"
    "scripts/verify-playlists-api-smoke.js"
    "scripts/verify-auth-api-smoke.js"
  )
  local script
  for script in "${smoke_scripts[@]}"; do
    run node "$script" --base-url="$base_url" --timeout-ms=15000
  done
  run node scripts/verify-categories-invariants.js --check-api --base-url="$base_url"

  info "Stopping test server (PID $test_server_pid)..."
  kill "$test_server_pid" 2>/dev/null || true
  info "All verification gates passed."
}

# ---------------------------------------------------------------------------
# Local image build + transfer + load
# ---------------------------------------------------------------------------
local_build_and_transfer() {
  local image_tag="$1" latest_tag="$2" state_file="$3" tar_path="$4" remote_tar="$5"
  local rank
  rank="$(stage_rank "$(state_get "$state_file" stage)")"

  if [ "$rank" -lt "$(stage_rank image-built)" ]; then
    info "Building image locally with full progress output..."
    run docker build --progress=plain \
      --build-arg NODE_MAX_OLD_SPACE_SIZE=8192 \
      --build-arg TURBO_CONCURRENCY=8 \
      -t "$image_tag" -t "$latest_tag" .
    update_state_stage "$state_file" "image-built"
  fi

  rank="$(stage_rank "$(state_get "$state_file" stage)")"
  if [ "$rank" -lt "$(stage_rank tar-saved)" ]; then
    info "Saving local image tar archive..."
    mkdir -p "$(dirname "$tar_path")"
    run docker save -o "$tar_path" "$image_tag"
    update_state_stage "$state_file" "tar-saved"
  fi

  rank="$(stage_rank "$(state_get "$state_file" stage)")"
  if [ "$rank" -lt "$(stage_rank tar-uploaded)" ]; then
    upload_image_tar "$tar_path" "$remote_tar"
    update_state_stage "$state_file" "tar-uploaded"
  fi

  rank="$(stage_rank "$(state_get "$state_file" stage)")"
  if [ "$rank" -lt "$(stage_rank image-loaded)" ]; then
    if ! ssh -o BatchMode=yes "$VPS_HOST" "test -s '$remote_tar'"; then
      warn "Resume checkpoint expected remote tar, but it is missing. Re-uploading..."
      upload_image_tar "$tar_path" "$remote_tar"
      update_state_stage "$state_file" "tar-uploaded"
    fi
    info "Loading uploaded image on VPS..."
    run_retry 5 4 ssh -o BatchMode=yes "$VPS_HOST" "set -e; docker load -i '$remote_tar' && rm -f '$remote_tar'"
    update_state_stage "$state_file" "image-loaded"
  fi
}

update_state_stage() {
  local state_file="$1" stage="$2"
  local tmp
  tmp="$(sed "s/\"stage\":\"[^\"]*\"/\"stage\":\"$stage\"/; s/\"updatedAt\":\"[^\"]*\"/\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"/" "$state_file")"
  printf '%s\n' "$tmp" > "$state_file"
}

# ---------------------------------------------------------------------------
# Optional DB restore (dump local DB → VPS)
# ---------------------------------------------------------------------------
restore_db_on_vps() {
  docker_available || error "--restore-db requires local Docker (to dump the local database). Install Docker, or drop --restore-db."
  local ts remote_dump remote_script
  ts="$(date +%Y%m%d-%H%M%S)"
  local local_dump="/tmp/ytr-db-$ts.sql"
  remote_dump="/tmp/ytr-db-$ts.sql"
  remote_script="/tmp/ytr-restore-$ts.sh"

  info "=== DB RESTORE: Dumping local database from Docker ==="
  run docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot "$MYSQL_DATABASE" --single-transaction --no-tablespaces --routines --triggers' > "$local_dump"

  local dump_bytes
  dump_bytes="$(stat -c %s "$local_dump")"
  [ "$dump_bytes" -ge 10240 ] || error "Dump is suspiciously small ($dump_bytes bytes) - aborting to protect VPS data."
  info "Dump size: $(( dump_bytes / 1024 / 1024 )) MB"

  info "Uploading dump to VPS..."
  run_retry 5 4 scp -o BatchMode=yes "$local_dump" "$VPS_HOST:$remote_dump"

  info "Restoring database on VPS..."
  cat > "$remote_script" <<'RESTORE'
#!/bin/sh
set -e
cd /srv/yehthatrocks
echo '[db-restore] Stopping web container...'
docker compose --env-file /srv/yehthatrocks/.env.production -f /srv/yehthatrocks/docker-compose.prod.yml stop web 2>/dev/null || true
DB_CTR=$(docker compose --env-file /srv/yehthatrocks/.env.production -f /srv/yehthatrocks/docker-compose.prod.yml ps -q db | head -n1)
if [ -z "$DB_CTR" ]; then echo '[db-restore] ERROR: db container not found' >&2; exit 1; fi
DB=$(docker exec "$DB_CTR" sh -c 'printf "%s" "$MYSQL_DATABASE"')
USR=$(docker exec "$DB_CTR" sh -c 'printf "%s" "$MYSQL_USER"')
PASS=$(docker exec "$DB_CTR" sh -c 'printf "%s" "$MYSQL_PASSWORD"')
echo "[db-restore] Restoring into: $DB"
docker exec "$DB_CTR" mysql -u"$USR" -p"$PASS" -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo '[db-restore] Importing dump...'
docker exec -i "$DB_CTR" mysql -u"$USR" -p"$PASS" "$DB" < RESTORE_DUMP_PATH
rm -f RESTORE_DUMP_PATH "$0"
echo '[db-restore] Complete.'
RESTORE
  sed -i "s|RESTORE_DUMP_PATH|$remote_dump|g" "$remote_script"

  run_retry 5 4 scp -o BatchMode=yes "$remote_script" "$VPS_HOST:$remote_script"
  run_retry 5 4 ssh -o BatchMode=yes "$VPS_HOST" "sh $remote_script"
  rm -f "$local_dump" "$remote_script"
  info "=== DB RESTORE complete ==="
}

# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------
password_gate

require_ssh

# Resolve build location. The production server runs Docker, so a local Docker
# install is not required to ship — the image can be built on the VPS instead.
if [ "$VPS_BUILD" -eq 1 ]; then
  info "VPS build requested — no local Docker required."
elif [ "$LOCAL_BUILD_REQUESTED" -eq 1 ]; then
  docker_available || error "Docker is required for a local build but is not available. Install Docker, or use: ship vps SECRET_PASSWORD"
else
  if docker_available; then
    info "Local Docker available — building the image locally."
  else
    warn "Docker is not installed locally. Building the image on the VPS instead (same as 'ship vps')."
    if [ "$RESTORE_DB" -eq 1 ]; then
      warn "--restore-db requires local Docker and will be skipped on this run."
      RESTORE_DB=0
    fi
    VPS_BUILD=1
  fi
fi

# Gate 0: clean worktree before any side-effect work
remove_untracked_empty_dirs
clean_worktree_gate

# regular mode: npm audit first (mirrors ship.cmd)
if [ "$MODE" = "regular" ]; then
  info "[regular] running npm audit"
  run npm audit --audit-level=critical
fi

dev_server_was_running=0
if [ "$SKIP_LOCAL_CLEANUP" -eq 0 ]; then
  initial_dev_pid="$(dev_server_pid)"
  if [ -n "$initial_dev_pid" ] && [ "$FORCE_FULL_CLEANUP_STOP_DEV_SERVER" -eq 0 ]; then
    info "Dev server detected on port 3000 (PID $initial_dev_pid). Keeping it online and running safe cache cleanup..."
    clean_repo_transient_caches 1
  else
    if [ "$FORCE_FULL_CLEANUP_STOP_DEV_SERVER" -eq 1 ]; then
      info "Force full cleanup requested; stopping dev server before cleanup..."
    fi
    if stop_dev_server; then dev_server_was_running=1; fi
    clean_repo_transient_caches 0
  fi
fi

if [ "$SKIP_MIGRATION_VALIDATION" -eq 0 ]; then
  info "Validating migrations for deployment safety..."
  if [ -f "$REPO_DIR/deploy/validate-migrations.sh" ]; then
    run bash "$REPO_DIR/deploy/validate-migrations.sh"
    info "All migration checks passed"
  else
    warn "Migration validation script not found; continuing without this non-critical check."
  fi
else
  warn "Skipping migration validation checks (-SkipMigrationValidation)."
fi

run_retry 5 4 git fetch origin "$BRANCH"
run git checkout "$BRANCH"

if [ "$RESUME" -eq 1 ]; then
  info "Resume run — skipping automatic dependency maintenance for the fixed commit."
elif [ "$SKIP_AUTO_DEPENDENCY_MAINTENANCE" -eq 0 ]; then
  warn "Automatic dependency maintenance is PowerShell-only (scripts/maintain-dependencies.ps1) and is skipped on Linux."
fi

if [ "$SKIP_GIT_PUSH" -eq 0 ]; then
  run_retry 5 4 git push origin "$BRANCH"
fi

current_sha="$(git rev-parse --short HEAD)"
[ -n "$current_sha" ] || error "Could not determine git commit SHA"

# --- Ship state / resume ---
state_dir="$(ship_state_dir)"
state_file="$state_dir/state.json"
tar_path="$state_dir/image.tar"
mkdir -p "$state_dir"

image_tag="$IMAGE_BASE:$current_sha"
latest_tag="$IMAGE_BASE:latest"
remote_tar="/tmp/yehthatrocks-image-$current_sha.tar"

if [ "$RESUME" -eq 1 ]; then
  [ -f "$state_file" ] || error "-Resume requested but no ship checkpoint state was found at $state_file"
  resume_branch="$(state_get "$state_file" branch)"
  resume_sha="$(state_get "$state_file" commitSha)"
  [ "$resume_branch" = "$BRANCH" ] || error "Checkpoint branch '$resume_branch' does not match requested branch '$BRANCH'."
  [ "$resume_sha" = "$current_sha" ] || error "Checkpoint commit '$resume_sha' does not match current HEAD '$current_sha'. Run fresh ship without -Resume."
  info "Resuming ship from stage '$(state_get "$state_file" stage)' for $(state_get "$state_file" imageTag)"
else
  if [ -f "$state_file" ]; then
    warn "Found stale ship checkpoint state. Starting fresh run and replacing it."
    rm -f "$state_file"
  fi
  printf '{"schemaVersion":1,"branch":"%s","commitSha":"%s","imageTag":"%s","latestTag":"%s","localTarPath":"%s","remoteTarPath":"%s","stage":"init","createdAt":"%s","updatedAt":"%s"}\n' \
    "$BRANCH" "$current_sha" "$image_tag" "$latest_tag" "$tar_path" "$remote_tar" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$state_file"
fi

# --- Verification gate ---
if [ "$SKIP_VERIFY_GATE" -eq 0 ] && [ "$(stage_rank "$(state_get "$state_file" stage)")" -lt "$(stage_rank gates-passed)" ]; then
  run_verify_gate
  update_state_stage "$state_file" "gates-passed"
elif [ "$SKIP_VERIFY_GATE" -eq 0 ]; then
  info "Resuming — verification gates already passed for this commit; skipping."
else
  warn "Skipping verification gates (-SkipVerifyGate)."
fi

# --- Build / transfer / deploy ---
if [ "$VPS_BUILD" -eq 1 ]; then
  info "Building image on VPS (no local build, no image transfer)..."
  vps_build_and_deploy "$image_tag" "$latest_tag" "$current_sha"
  update_state_stage "$state_file" "deployed"
else
  local_build_and_transfer "$image_tag" "$latest_tag" "$state_file" "$tar_path" "$remote_tar"

  if [ "$RESTORE_DB" -eq 1 ]; then
    restore_db_on_vps
  fi

  if [ "$(stage_rank "$(state_get "$state_file" stage)")" -lt "$(stage_rank deployed)" ]; then
    deploy_hot_swap "$image_tag"
    update_state_stage "$state_file" "deployed"
  fi
fi

# --- Cleanup ---
rm -f "$tar_path"
rm -f "$state_file"

info "Deploy complete: $image_tag"

if [ "$SKIP_LOCAL_CLEANUP" -eq 0 ] && [ "$SKIP_DOCKER_PRUNE" -eq 0 ] && [ "$VPS_BUILD" -eq 0 ]; then
  warn "Pruning all unused local Docker build/image cache..."
  docker builder prune -af >/dev/null 2>&1 || true
  docker image prune -af >/dev/null 2>&1 || true
  docker container prune -f >/dev/null 2>&1 || true
fi

if [ "$dev_server_was_running" -eq 1 ] && [ "$FORCE_FULL_CLEANUP_STOP_DEV_SERVER" -eq 1 ]; then
  start_dev_server
fi
