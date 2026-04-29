#!/usr/bin/env bash
# Migration validation and safety wrapper for Prisma deployments.
# Detects and prevents common issues before they cause deploy failures.
#
# Common issues handled:
#   - Duplicate index/constraint creation (P3018)
#   - Incomplete migration states (P3015) 
#   - Multiple sequential migrations with same intent
#
# Usage: 
#   bash migrate-safely.sh --check <repo-dir>       # Validate migrations for issues
#   bash migrate-safely.sh --deploy <compose-cmd> <image> <schema-path>

set -euo pipefail

log_info() { echo "[migrate] $1"; }
log_warn() { echo "[migrate] WARNING: $1" >&2; }
log_error() { echo "[migrate] ERROR: $1" >&2; }

check_migrations() {
  local repo_dir="$1"
  local migrations_dir="$repo_dir/prisma/migrations"
  
  if [ ! -d "$migrations_dir" ]; then
    log_error "Migrations directory not found: $migrations_dir"
    return 1
  fi
  
  log_info "Validating migration files..."
  
  # Check for duplicate index/constraint operations in adjacent migrations
  local prev_operation="" prev_dir=""
  while IFS= read -r migration_dir; do
    local migration_sql="$migration_dir/migration.sql"
    if [ ! -f "$migration_sql" ]; then
      continue
    fi
    
    # Extract create index/constraint operations
    local operations
    operations=$(grep -E "^(CREATE|DROP) (INDEX|CONSTRAINT)" "$migration_sql" || true)
    
    if [ -n "$operations" ]; then
      # Check if this migration duplicates the previous one's operations
      if [ -n "$prev_operation" ] && [ "$operations" = "$prev_operation" ]; then
        log_error "Duplicate operations detected in consecutive migrations:"
        log_error "  Previous: $prev_dir"
        log_error "  Current:  $(basename "$migration_dir")"
        log_error ""
        log_error "This will cause P3018 (duplicate key) failures on deploy."
        log_error "Delete the newer migration and rebuild without the auto-hook."
        return 1
      fi
      prev_operation="$operations"
      prev_dir="$(basename "$migration_dir")"
    fi
  done < <(find "$migrations_dir" -maxdepth 1 -type d -name "20*" | sort)
  
  log_info "Migration validation passed"
  return 0
}

deploy_migrations() {
  local compose_cmd="$1"
  local web_image="$2"
  local schema_path="$3"
  
  log_info "Deploying migrations..."
  
  local migration_output
  migration_output=$(mktemp)
  trap "rm -f '$migration_output'" RETURN

  run_deploy() {
    WEB_IMAGE="$web_image" $compose_cmd run --rm --no-deps web \
      sh -c "npx prisma migrate deploy --schema $schema_path" > "$migration_output" 2>&1
  }
  
  if ! run_deploy; then
    
    local error_text
    error_text=$(cat "$migration_output")

    if echo "$error_text" | grep -q "P3009"; then
      local failed_migration
      failed_migration=$(printf '%s\n' "$error_text" | sed -n 's/.*`\([^`][^`]*\)` migration started.*/\1/p' | head -n1)

      if [ -n "$failed_migration" ]; then
        log_warn "Detected failed migration state for: $failed_migration"

        if WEB_IMAGE="$web_image" $compose_cmd run --rm --no-deps web \
            sh -c "[ -d /app/prisma/migrations/$failed_migration ]" >/dev/null 2>&1; then
          log_error "P3009 detected, but migration directory still exists: $failed_migration"
          log_error "Manual intervention required; refusing automatic rollback resolution."
          echo "$error_text" | tail -20 >&2
          return 1
        fi

        log_warn "Migration directory for $failed_migration is missing in current code; resolving as rolled back."
        if ! WEB_IMAGE="$web_image" $compose_cmd run --rm --no-deps web \
            sh -c "npx prisma migrate resolve --rolled-back $failed_migration --schema $schema_path"; then
          log_error "Failed to resolve stale migration state for $failed_migration"
          return 1
        fi

        log_info "Retrying prisma migrate deploy after stale migration resolution..."
        if run_deploy; then
          log_info "Migrations deployed successfully"
          return 0
        fi

        error_text=$(cat "$migration_output")
      fi
    fi
    
    # Provide actionable error messages for common issues
    if echo "$error_text" | grep -q "P3018"; then
      log_error "Migration conflict: P3018 (duplicate constraint/index)"
      log_error ""
      log_error "This typically happens when:"
      log_error "  1. Prisma's pre-commit hook auto-generated a migration with duplicate operations"
      log_error "  2. Multiple migrations tried to create the same index"
      log_error ""
      log_error "Resolution:"
      log_error "  1. Check prisma/migrations/ for duplicate CREATE INDEX operations"
      log_error "  2. Delete the redundant auto-generated migration"
      log_error "  3. Commit the fix and redeploy"
      log_error ""
      log_error "Raw error:"
      echo "$error_text" | tail -20 >&2
      
    elif echo "$error_text" | grep -q "P3015"; then
      log_error "Invalid migration state: P3015"
      log_error "Previous migrations are incomplete or corrupted."
      log_error ""
      log_error "This requires manual intervention on the database:"
      log_error "  1. Connect to the database"
      log_error "  2. Check _prisma_migrations table for incomplete entries"
      log_error "  3. Either mark them complete or roll them back"
      log_error ""
      echo "$error_text" >&2
      
    else
      log_error "Migration deployment failed:"
      echo "$error_text" >&2
    fi
    
    return 1
  fi
  
  log_info "Migrations deployed successfully"
  return 0
}

# Main entry point
case "${1:-}" in
  --check)
    check_migrations "$2"
    ;;
  --deploy)
    deploy_migrations "$2" "$3" "$4"
    ;;
  *)
    echo "Usage: $0 --check <repo-dir> | --deploy <compose-cmd> <web-image> <schema-path>" >&2
    exit 1
    ;;
esac
