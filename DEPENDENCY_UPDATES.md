# Automated Dependency Update System

YehThatRocks uses a resilient, multi-layered system to keep all dependencies current while preventing breaking changes from reaching production.

## How it works

```
┌─────────────────────────────────────────────────────┐
│                  UPDATE PIPELINE                     │
│                                                      │
│  Phase 0 ──► Snapshot (git stash)                    │
│  Phase 1 ──► Safe patch/minor bumps (batch)          │
│              ├─ Build check                          │
│              ├─ Invariant check                      │
│              └─ Rollback on failure                  │
│  Phase 2 ──► Major bumps (one at a time)             │
│              ├─ Build + invariant per package        │
│              ├─ Auto-fix rules for known patterns    │
│              └─ Per-package rollback on failure      │
│  Phase 3 ──► Full verification (full invariants)     │
│  Phase 4 ──► Commit batches separately, push         │
└─────────────────────────────────────────────────────┘
```

## Three layers of protection

### 1. Version pinning

Critical packages are pinned as **exact versions** (no `^` or `~`):

| Package | Pinned at | Reason |
|---------|-----------|--------|
| `next` | `16.2.9` | Core framework — drift breaks everything |
| `react` / `react-dom` | `19.2.7` | Runtime — mismatches cause hydration errors |
| `prisma` | `7.8.0` | Database — schema incompatibility is catastrophic |
| `@prisma/client` | `7.8.0` | Must match prisma version exactly |
| `@prisma/adapter-mariadb` | `7.8.0` | Must match prisma version exactly |

This prevents `npm audit fix --force` from downgrading them. The automated pipeline can still bump these — but only after passing verification.

### 2. Resilient update script

**`scripts/maintain-dependencies.ps1`** — the core pipeline.

| Parameter | Effect |
|-----------|--------|
| `-DryRun` | Scan only — reports what would change, makes zero modifications |
| `-SkipPush` | Update + verify + commit, but don't push to remote |
| (default) | Full pipeline: update → verify → commit → push |

**Auto-fix rules** handle known breaking changes:
- Next.js config drift (`next.config.ts` → `next.config.js`)
- Stale `.next` build cache after Next.js version changes

**Rollback**: If any batch fails verification, it's rolled back atomically. The rest of the pipeline continues.

### 3. CI guardrails

**`.github/workflows/auto-update-deps.yml`** — runs daily at 03:17 UTC.

- Checks out main, installs dependencies, runs the maintenance pipeline
- On success: commits and pushes updated `package.json` + `package-lock.json`
- On failure: creates a GitHub Issue with the full report attached
- Manual trigger available via `workflow_dispatch` (with dry-run option)

## Running it

### Windows Scheduled Task (local machine)

```powershell
# Install the weekly task
.\scripts\install-dependency-maintenance-task.ps1

# Install in dry-run mode (safe — no commits)
.\scripts\install-dependency-maintenance-task.ps1 -DryRun
```

The task runs every Monday at 3:17am. To switch to daily, open Task Scheduler and change the trigger.

### Manual run

```powershell
# Dry run — see what would change
.\scripts\maintain-dependencies.ps1 -DryRun

# Full run — update, verify, commit, push
.\scripts\maintain-dependencies.ps1

# Update + verify + commit, but don't push
.\scripts\maintain-dependencies.ps1 -SkipPush
```

### GitHub Actions (CI)

- **Automatic**: Runs daily at 03:17 UTC
- **Manual**: Go to Actions → "Auto-Update Dependencies" → "Run workflow"
  - Check "Dry run" to scan without committing

## What happens when something breaks

1. **Safe updates fail** → Entire batch rolled back, no changes committed
2. **Major bump fails** → That specific package rolled back, other majors continue
3. **Full verification fails** → Everything rolled back to pre-update snapshot
4. **npm audit has high/critical** → Update proceeds but logs a warning (vulnerabilities may pre-date the update)

Failed runs on GitHub Actions automatically create an issue with the full report.

## Adding new auto-fix rules

Edit `scripts/maintain-dependencies.ps1` and add an entry to `$AutoFixRules`:

```powershell
@{
    Name        = "descriptive-name"
    Description = "What this rule detects and fixes"
    Check       = { return $true }  # Return $true when fix is needed
    Fix         = { ... }           # Apply the fix
}
```

## Report

After every run, a timestamped report is written to `dependency-update-report.txt` in the repo root. On GitHub Actions, this is uploaded as a workflow artifact (30-day retention).
