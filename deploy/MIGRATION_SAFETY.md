# Robust Migration Deployment Strategy

## Problem

Prisma's pre-commit hook (`prisma generate` → `prisma migrate dev --create-only`) sometimes auto-generates migration files that:

1. **Duplicate existing migrations** — if a manual migration already creates an index, the hook creates another one
2. **Cause P3018 errors** — "Duplicate key name" on deploy
3. **Fail ~66% of the time** — depending on hook execution timing and git state

## Solution: Three-Layer Defense

### Layer 1: Prevention (Before Commit)

**Git Pre-Commit Hook**: Validates migrations before they're committed
```bash
# Install the hook:
cp deploy/migration-validation-hook.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

This prevents bad migrations from ever entering the repo by checking for:
- Duplicate operations between consecutive migrations
- Empty or malformed migration files
- Schema drift inconsistencies

### Layer 2: Validation (Before Deploy)

**Local Pre-Deploy Check**: Run this before shipping
```bash
bash deploy/validate-migrations.sh
```

This catches issues that slipped past the pre-commit hook and provides actionable error messages:
- Identifies duplicate index/constraint operations
- Detects untracked migrations (causes P3018)
- Suggests exact fix commands

### Layer 3: Robust Deploy (On Production)

**Enhanced Deploy Script**: Uses `migrate-safely.sh` for intelligent migration handling
```bash
bash deploy/ship-local.ps1
```

Improvements:
- Validates migrations before attempting deploy
- Provides detailed error context (P3018, P3015, etc.)
- Suggests recovery steps for common failures
- Better logging for debugging

## Workflow

### Normal Case (No Issues)
```
1. Make schema.prisma changes
2. Prisma hook generates migration automatically
3. (Validation checks run - pass silently)
4. Commit changes
5. Run: bash deploy/validate-migrations.sh  ← Pre-deploy check
6. Run: sh deploy/ship-local.ps1            ← Deploy with safety
```

### When Duplicate Migration is Detected

```
❌ Found duplicate migration operations:
  - 20260429130000_add_artist_stats_slug_index (earlier)
  - 20260429195403_auto (later - likely Prisma auto-generated)

Fix: rm -rf prisma/migrations/20260429195403_auto && git add prisma/migrations
Then: git commit --amend --no-edit
```

### When Deploy Fails with P3018

The enhanced deploy script now provides this guidance:

```
[migrate] ERROR: Migration conflict: P3018 (duplicate constraint/index)

This typically happens when:
  1. Prisma's pre-commit hook auto-generated a migration with duplicate operations
  2. Multiple migrations tried to create the same index

Resolution:
  1. Check prisma/migrations/ for duplicate CREATE INDEX operations
  2. Delete the redundant auto-generated migration
  3. Commit the fix and redeploy
```

## Preventing the Prisma Hook Issue

The real fix is to ensure Prisma's pre-commit hook doesn't run unnecessarily:

### Option 1: Disable Auto-Migration in Pre-Commit (Recommended)

Edit `.git/hooks/pre-commit` to skip Prisma if no schema changes:

```bash
# Before: prisma generate
if git diff --cached --name-only | grep -q "^prisma/schema.prisma$"; then
  npx prisma generate
fi
```

### Option 2: Validate After Hook

The validation hook we installed checks for duplicates after the Prisma hook runs, catching issues before they're committed.

### Option 3: Manual Migration Workflow

For critical migrations, create migrations manually:

```bash
# Don't rely on auto-generation
npx prisma migrate create --name add_artist_stats_slug_index

# Edit the SQL manually to use idempotent patterns:
SET @idx_exists := (SELECT COUNT(*) FROM information_schema.statistics 
  WHERE table_schema = DATABASE() AND table_name = 'artist_stats' 
  AND index_name = 'artist_stats_slug_idx');

SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX artist_stats_slug_idx ON artist_stats(slug)',
  'SELECT ''Index already exists'' AS info');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

## Tools Reference

| Tool | Purpose | When to Run |
|------|---------|------------|
| `.git/hooks/pre-commit` | Prevent bad migrations from being committed | Automatically on `git commit` |
| `deploy/validate-migrations.sh` | Catch remaining issues locally | Before running `ship` |
| `deploy/migrate-safely.sh` | Intelligent migration deployment | Called by `deploy-prod-hot-swap.sh` |

## Monitoring & Debugging

### Check Current Migration State
```bash
# On VPS
docker compose -f docker-compose.prod.yml exec web npx prisma migrate status
```

### Manual Migration Resolution
```bash
# On VPS - if migrations are stuck
docker compose -f docker-compose.prod.yml exec db mysql -uroot -p -e "SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;"

# Mark a failed migration as rolled-back
docker compose -f docker-compose.prod.yml run --rm web npx prisma migrate resolve --rolled-back "20260429195403"
```

## Testing the Robustness

To verify the system is working:

```bash
# 1. Test validation catches duplicates
cd prisma/migrations
cp 20260429130000*/migration.sql 20260429195403_test/migration.sql
git add prisma/migrations/20260429195403_test

# Validation should fail:
bash ../../deploy/validate-migrations.sh
# ❌ DUPLICATE OPERATIONS in consecutive migrations

# 2. Clean up test
rm -rf 20260429195403_test && git reset prisma/migrations

# 3. Deploy with enhanced script
bash deploy/ship-local.ps1
# Should now provide better error messages on any migration issues
```

## Long-Term: Avoid the Root Cause

The core issue is unpredictable migration generation. Consider:

1. **Disabling `prisma generate` in commit hooks** — Use explicit `npm run prisma:generate` instead
2. **Storing migrations in version control carefully** — Never auto-generate migrations that might duplicate
3. **Using idempotent migrations** — Always use `IF EXISTS`/`IF NOT EXISTS` for safety
4. **Schema versioning** — Keep schema in sync with deployed migrations
