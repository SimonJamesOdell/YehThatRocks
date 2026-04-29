#!/usr/bin/env bash
# Git pre-commit hook: validate Prisma migrations before commit
# This prevents common migration issues from reaching production.
#
# Install: cp deploy/migration-validation-hook.sh .git/hooks/pre-commit

set -euo pipefail

log_warn() { echo "⚠  $1" >&2; }
log_error() { echo "❌ $1" >&2; }
log_pass() { echo "✓ $1"; }

# Check if migrations have suspicious patterns that indicate pre-commit hook duplicates
check_for_duplicate_migrations() {
  local repo_dir
  repo_dir="$(git rev-parse --show-toplevel)"
  local migrations_dir="$repo_dir/prisma/migrations"
  
  if [ ! -d "$migrations_dir" ]; then
    return 0
  fi
  
  # Find consecutive migrations with same CREATE/DROP operations
  local prev_ops="" prev_dir=""
  local duplicates_found=0
  
  while IFS= read -r migration_dir; do
    [ -z "$migration_dir" ] && continue
    local migration_sql="$migration_dir/migration.sql"
    [ ! -f "$migration_sql" ] && continue
    
    # Extract the operations (ignoring IF EXISTS/IF NOT EXISTS clauses)
    local ops
    ops=$(sed -E 's/IF (NOT )?EXISTS|IF NOT EXISTS//' "$migration_sql" | grep -E "^(CREATE|DROP) (INDEX|CONSTRAINT|KEY)" | sort || true)
    
    if [ -n "$ops" ] && [ -n "$prev_ops" ]; then
      # Normalize whitespace and compare
      local ops_normalized prev_ops_normalized
      ops_normalized=$(echo "$ops" | tr -s ' ' | sort)
      prev_ops_normalized=$(echo "$prev_ops" | tr -s ' ' | sort)
      
      if [ "$ops_normalized" = "$prev_ops_normalized" ]; then
        log_error "Found duplicate migration operations:"
        log_error "  - $(basename "$prev_dir") (earlier)"
        log_error "  - $(basename "$migration_dir") (later - likely Prisma auto-generated)"
        log_error ""
        log_error "The later one should be deleted. This usually happens when:"
        log_error "  1. You modified prisma/schema.prisma and committed it"
        log_error "  2. Prisma's pre-commit hook auto-generated a migration"
        log_error "  3. But a manual migration with the same intent already existed"
        log_error ""
        log_error "Fix: rm -rf '$migration_dir' && git add prisma/migrations"
        duplicates_found=1
      fi
    fi
    
    [ -n "$ops" ] && prev_ops="$ops" && prev_dir="$migration_dir"
  done < <(find "$migrations_dir" -maxdepth 1 -type d -name "20*" | sort)
  
  return $duplicates_found
}

# Check for empty or malformed migrations
check_for_empty_migrations() {
  local repo_dir
  repo_dir="$(git rev-parse --show-toplevel)"
  local migrations_dir="$repo_dir/prisma/migrations"
  
  if [ ! -d "$migrations_dir" ]; then
    return 0
  fi
  
  local issues=0
  while IFS= read -r migration_dir; do
    [ -z "$migration_dir" ] && continue
    local migration_sql="$migration_dir/migration.sql"
    
    # Check if migration is empty or only comments
    if [ ! -f "$migration_sql" ] || ! grep -v '^--' "$migration_sql" | grep -v '^/\*' | grep -q '[^[:space:]]'; then
      log_error "Empty migration file: $migration_sql"
      log_error "This will cause deploy failures. Delete it:"
      log_error "  rm -rf '$migration_dir' && git add prisma/migrations"
      issues=1
    fi
  done < <(find "$migrations_dir" -maxdepth 1 -type d -name "20*" 2>/dev/null || true)
  
  return $issues
}

# Main validation
main() {
  log_pass "Validating Prisma migrations..."
  
  local issues=0
  
  if ! check_for_duplicate_migrations; then
    issues=1
  fi
  
  if ! check_for_empty_migrations; then
    issues=1
  fi
  
  if [ $issues -eq 0 ]; then
    log_pass "Migration validation passed"
    return 0
  fi
  
  return 1
}

main "$@"
